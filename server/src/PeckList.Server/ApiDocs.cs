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

    /// <summary>The name the API key scheme has in the document.</summary>
    public const string KeyScheme = "apiKey";

    public static IServiceCollection AddApiDocs(this IServiceCollection services) =>
        services.AddOpenApi("v1", options =>
        {
            // Only the API: sign-in pages, provider callbacks and the web app's fallback are pages.
            options.ShouldInclude = description =>
                description.RelativePath?.StartsWith("api/", StringComparison.OrdinalIgnoreCase) == true;
            // Grouped by area, the segment after /api (or /api/admin): Sync, Friends, Admin settings...
            options.AddOperationTransformer((operation, context, _) =>
            {
                operation.Tags = new HashSet<OpenApiTagReference> { new(Area(context.Description.RelativePath), context.Document) };
                return Task.CompletedTask;
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
                        "the session works too. Tasks, lists and the rest of the workspace are written through " +
                        "POST /api/sync with per-field clocks; see the docs' Data model and sync page.",
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

    /// <summary>"api/admin/settings/{key}" is "Admin: settings", "api/friends/code" is "Friends".</summary>
    internal static string Area(string? relativePath)
    {
        var parts = (relativePath ?? "").Split('/', StringSplitOptions.RemoveEmptyEntries).Skip(1).ToList();
        var admin = parts.FirstOrDefault() == "admin";
        var area = (admin ? parts.Skip(1) : parts).FirstOrDefault(part => !part.StartsWith('{')) ?? "server";
        area = Path.GetFileNameWithoutExtension(area);
        area = char.ToUpperInvariant(area[0]) + area[1..];
        return admin ? $"Admin: {area.ToLowerInvariant()}" : area;
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
