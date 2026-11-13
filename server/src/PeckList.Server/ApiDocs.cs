using Microsoft.OpenApi;
using PeckList.Core.Configuration;

namespace PeckList.Server;

/// <summary>
/// The HTTP API described as an OpenAPI document (<see cref="DocumentPath"/>) and a Swagger UI page
/// that reads it (<see cref="PagePath"/>), spec: PL-118. Both are public, like the source code: they
/// show what the API offers, never anyone's data. <c>API_DOCS=off</c> turns both into 404s, live.
/// </summary>
public static class ApiDocs
{
    public const string DocumentPath = "/api/openapi/v1.json";
    public const string PagePath = "/api/docs";

    /// <summary>The JSON body a route takes, for the document (the route reads it itself).</summary>
    public sealed record Body(Type Type, bool Optional = false, string ContentType = "application/json");

    /// <summary>
    /// How the routes outside <c>/api/v1</c> refuse: a snake_case <c>error</c> code the web app words
    /// (<c>web/src/adapters/http-admin.ts</c>), sometimes with a sentence. The task API uses problems.
    /// </summary>
    public sealed record Refusal(string Error, string? Message = null);

    /// <summary>The name the API key scheme has in the document.</summary>
    public const string KeyScheme = "apiKey";

    /// <summary>A route's summary and the JSON it answers with on success.</summary>
    public static RouteHandlerBuilder Doc<T>(this RouteHandlerBuilder route, string summary, int status = StatusCodes.Status200OK) =>
        route.WithSummary(summary).Produces<T>(status);

    /// <summary>A route's summary, for one that answers with no body (204 unless said otherwise).</summary>
    public static RouteHandlerBuilder Doc(this RouteHandlerBuilder route, string summary, int status = StatusCodes.Status204NoContent) =>
        route.WithSummary(summary).Produces(status);

    /// <summary>A route that answers with a file or a stream rather than JSON.</summary>
    public static RouteHandlerBuilder DocFile(this RouteHandlerBuilder route, string summary, string contentType, params string[] more) =>
        route.WithSummary(summary).Produces(StatusCodes.Status200OK, typeof(Stream), contentType, more);

    /// <summary>The body a route reads itself, JSON unless said otherwise (described, not enforced, unlike Accepts).</summary>
    public static RouteHandlerBuilder Takes<TBody>(this RouteHandlerBuilder route, bool optional = false, string contentType = "application/json") =>
        route.WithMetadata(new Body(typeof(TBody), optional, contentType));

    /// <summary>The statuses a route refuses with, each a <see cref="Refusal"/>.</summary>
    public static RouteHandlerBuilder Refuses(this RouteHandlerBuilder route, params int[] statuses)
    {
        foreach (var status in statuses) route.Produces<Refusal>(status);
        return route;
    }

    /// <summary>The statuses a <c>/api/v1</c> route refuses with, each a problem document.</summary>
    public static RouteHandlerBuilder ProblemAt(this RouteHandlerBuilder route, params int[] statuses)
    {
        foreach (var status in statuses) route.Produces<Api.ApiProblems.Problem>(status, Api.ApiProblems.ContentType);
        return route;
    }

    /// <summary>
    /// A query parameter a route reads from the request itself, for the document. <paramref name="Many"/>:
    /// it may be repeated (<c>?tag=a&amp;tag=b</c>), so it is an array of <paramref name="Type"/>.
    /// </summary>
    public sealed record QueryParameter(string Name, string Description, JsonSchemaType Type = JsonSchemaType.String, bool Many = false);

    /// <summary>The query parameters a route reads itself, so the document and the client list them.</summary>
    public static RouteHandlerBuilder Queries(this RouteHandlerBuilder route, params QueryParameter[] parameters)
    {
        foreach (var parameter in parameters) route.WithMetadata(parameter);
        return route;
    }

    /// <summary>A bare 404: nothing by that id that the caller may see.</summary>
    public static RouteHandlerBuilder Missing(this RouteHandlerBuilder route) => route.Produces(StatusCodes.Status404NotFound);

    /// <summary>
    /// What it takes to call a route, read from the route itself so the document can't drift from
    /// the rules: signed in or not, the admin permission, and the API key scope (or that keys can't).
    /// </summary>
    internal static string? Access(IList<object> metadata, string method, string relativePath)
    {
        var anonymous = metadata.OfType<Microsoft.AspNetCore.Authorization.IAllowAnonymous>().Any();
        var signedIn = !anonymous && metadata.OfType<Microsoft.AspNetCore.Authorization.IAuthorizeData>().Any();
        if (!signedIn) return null;
        var lines = new List<string>();
        if (metadata.OfType<Auth.RequiresPermission>().LastOrDefault() is { } permission)
        {
            lines.Add($"Admin permission: {permission.Permission}.");
        }
        var scope = Auth.ApiKeyAuth.ScopeFor(method, new PathString("/" + relativePath));
        lines.Add(scope switch
        {
            null => "API keys can't use this route: sign in to the web app instead.",
            Auth.ApiKeyAuth.AnyScope => "Any working API key may use this route.",
            _ => $"An API key needs the {scope} scope.",
        });
        return string.Join(' ', lines);
    }

    public static IServiceCollection AddApiDocs(this IServiceCollection services) =>
        services.AddOpenApi("v1", options =>
        {
            // Components are named by the type's simple name: two types of one name would share a
            // schema, so the second refuses to build the document rather than describe it wrongly.
            var componentTypes = new System.Collections.Concurrent.ConcurrentDictionary<string, Type>();
            string ComponentName(Type type)
            {
                var owner = componentTypes.GetOrAdd(type.Name, type);
                return owner == type
                    ? type.Name
                    : throw new InvalidOperationException($"Two types are named {type.Name} in the API document ({owner.FullName} and {type.FullName}): rename one.");
            }

            // Only the API: sign-in pages, provider callbacks and the web app's fallback are pages.
            options.ShouldInclude = description =>
                description.RelativePath?.StartsWith("api/", StringComparison.OrdinalIgnoreCase) == true;
            // Grouped by area, the segment after /api (or /api/admin): Sync, Friends, Admin settings...
            options.AddOperationTransformer((operation, context, _) =>
            {
                operation.Tags = new HashSet<OpenApiTagReference> { new(Area(context.Description.RelativePath), context.Document) };
                return Task.CompletedTask;
            });
            // A route that reads its body itself says what it takes with Body: JSON, or raw bytes.
            options.AddOperationTransformer(async (operation, context, cancellation) =>
            {
                if (context.Description.ActionDescriptor.EndpointMetadata.OfType<Body>().FirstOrDefault() is not { } body) return;
                IOpenApiSchema schema;
                if (body.Type == typeof(Stream))
                {
                    schema = new OpenApiSchema { Type = JsonSchemaType.String, Format = "binary" };
                }
                else
                {
                    var componentName = ComponentName(body.Type);
                    context.Document!.AddComponent(componentName, await context.GetOrCreateSchemaAsync(body.Type, null, cancellation));
                    schema = new OpenApiSchemaReference(componentName, context.Document);
                }
                operation.RequestBody = new OpenApiRequestBody
                {
                    Required = !body.Optional,
                    Content = new Dictionary<string, OpenApiMediaType> { [body.ContentType] = new() { Schema = schema } },
                };
            });
            // The server reads numbers sent as strings too (the web JSON defaults), but it always
            // writes numbers: the document says number, so a client's types do too.
            options.AddSchemaTransformer((schema, _, _) =>
            {
                if (schema.Type is { } type && type.HasFlag(JsonSchemaType.String)
                    && (type.HasFlag(JsonSchemaType.Integer) || type.HasFlag(JsonSchemaType.Number)))
                {
                    schema.Type = type & ~JsonSchemaType.String;
                    schema.Pattern = null;
                }
                return Task.CompletedTask;
            });
            // Query parameters a route reads by hand, in the order it lists them.
            options.AddOperationTransformer((operation, context, _) =>
            {
                var queries = context.Description.ActionDescriptor.EndpointMetadata.OfType<QueryParameter>().ToList();
                if (queries.Count == 0) return Task.CompletedTask;
                operation.Parameters ??= new List<IOpenApiParameter>();
                foreach (var query in queries)
                {
                    operation.Parameters.Add(new OpenApiParameter
                    {
                        Name = query.Name,
                        In = ParameterLocation.Query,
                        Description = query.Description,
                        Schema = query.Many
                            ? new OpenApiSchema { Type = JsonSchemaType.Array, Items = new OpenApiSchema { Type = query.Type } }
                            : new OpenApiSchema { Type = query.Type },
                        // Form style with explode (the default, so not written): a repeatable one is ?tag=a&tag=b.
                        Explode = true,
                    });
                }
                return Task.CompletedTask;
            });
            // A route with a rate limit says so: the 429 carries Retry-After.
            options.AddOperationTransformer((operation, context, _) =>
            {
                if (context.Description.ActionDescriptor.EndpointMetadata.OfType<Microsoft.AspNetCore.RateLimiting.EnableRateLimitingAttribute>().Any())
                {
                    operation.Responses ??= new OpenApiResponses();
                    operation.Responses.TryAdd("429", new OpenApiResponse { Description = "Too many requests: wait as Retry-After says" });
                }
                return Task.CompletedTask;
            });
            // Who may call it, and the two refusals every signed-in route can give.
            options.AddOperationTransformer(async (operation, context, cancellation) =>
            {
                var description = context.Description;
                if (Access(description.ActionDescriptor.EndpointMetadata, description.HttpMethod ?? "GET", description.RelativePath ?? "") is not { } access) return;
                operation.Description = string.IsNullOrEmpty(operation.Description) ? access : $"{operation.Description}\n\n{access}";
                operation.Responses ??= new OpenApiResponses();
                operation.Responses.TryAdd("401", new OpenApiResponse { Description = "Not signed in, or the API key is not a working one" });
                if (operation.Responses.ContainsKey("403")) return;
                // The task API refuses with problems, the older routes with a Refusal.
                var (type, contentType) = description.RelativePath?.StartsWith("api/v1/", StringComparison.Ordinal) == true
                    ? (typeof(Api.ApiProblems.Problem), Api.ApiProblems.ContentType)
                    : (typeof(Refusal), "application/json");
                var schemaName = ComponentName(type);
                context.Document!.AddComponent(schemaName, await context.GetOrCreateSchemaAsync(type, null, cancellation));
                operation.Responses["403"] = new OpenApiResponse
                {
                    Description = "Not allowed: password_change_required, a key without the scope (scope), or a missing permission",
                    Content = new Dictionary<string, OpenApiMediaType>
                    {
                        [contentType] = new() { Schema = new OpenApiSchemaReference(schemaName, context.Document) },
                    },
                };
            });
            options.AddDocumentTransformer((document, _, _) =>
            {
                document.Info = new OpenApiInfo
                {
                    Title = "PeckList API",
                    Version = ServerApp.Version,
                    Description =
                        "The HTTP API of a PeckList server. Sign in with an API key from Settings > API keys " +
                        "(Authorize, then the key as it was shown: pl_...). In a browser signed in to this server, " +
                        "the session works too. For tasks, lists, sections and tags use the task API under " +
                        "/api/v1: plain JSON, versioned, errors as problem+json with a stable code. POST /api/sync " +
                        "is the apps' internal sync protocol and changes with them.",
                };
                // The areas the operations were put in, in order, instead of the generator's own.
                document.Tags = new HashSet<OpenApiTag>(
                    document.Paths.Values
                        .SelectMany(path => path.Operations?.Values ?? Enumerable.Empty<OpenApiOperation>())
                        .SelectMany(operation => operation.Tags ?? new HashSet<OpenApiTagReference>())
                        .Select(tag => tag.Name).OfType<string>().Distinct()
                        .Order(StringComparer.Ordinal)
                        .Select(name => new OpenApiTag { Name = name }));
                document.Components ??= new OpenApiComponents();
                document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
                document.Components.SecuritySchemes[KeyScheme] = new OpenApiSecurityScheme
                {
                    Type = SecuritySchemeType.Http,
                    Scheme = "bearer",
                    BearerFormat = "pl_<id>_<secret>",
                    Description = "An API key from Settings > API keys, sent as Authorization: Bearer pl_...",
                };
                document.Security = [new OpenApiSecurityRequirement { [new OpenApiSecuritySchemeReference(KeyScheme, document)] = [] }];
                return Task.CompletedTask;
            });
        });

    /// <summary>"api/admin/settings/{key}" is "Admin: settings", "api/v1/tasks/{id}" is "v1: tasks", "api/friends/code" is "Friends".</summary>
    internal static string Area(string? relativePath)
    {
        var parts = (relativePath ?? "").Split('/', StringSplitOptions.RemoveEmptyEntries).Skip(1).ToList();
        var admin = parts.FirstOrDefault() == "admin";
        var v1 = parts.FirstOrDefault() == "v1";
        var area = (admin || v1 ? parts.Skip(1) : parts).FirstOrDefault(part => !part.StartsWith('{')) ?? "server";
        area = Path.GetFileNameWithoutExtension(area);
        area = char.ToUpperInvariant(area[0]) + area[1..];
        return admin ? $"Admin: {area.ToLowerInvariant()}" : v1 ? $"v1: {area.ToLowerInvariant()}" : area;
    }

    /// <summary>Before the endpoints: the off switch, then the Swagger UI page (its own middleware).</summary>
    public static void UseApiDocs(this WebApplication app)
    {
        // Read on every request, so the setting applies the moment it is saved.
        app.Use(async (context, next) =>
        {
            var path = context.Request.Path;
            if ((path.StartsWithSegments("/api/openapi") || path.StartsWithSegments(PagePath))
                && !context.RequestServices.GetRequiredService<LiveSettings>().Current.ApiDocs)
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }
            await next();
        });
        app.UseSwaggerUI(options =>
        {
            options.RoutePrefix = PagePath.TrimStart('/');
            // Relative to the page (/api/docs/index.html), so it holds behind any proxy.
            options.SwaggerEndpoint("../openapi/v1.json", "PeckList API");
            options.DocumentTitle = "PeckList API";
        });
    }

    public static void MapApiDocs(this WebApplication app) => app.MapOpenApi("/api/openapi/{documentName}.json");
}
