using System.Security.Claims;
using PeckList.Core.Accounts;
using PeckList.Core.Api;
using PeckList.Server.Auth;

namespace PeckList.Server.Api;

/// <summary>Who is calling: the account, and the key when it is one.</summary>
public sealed record ApiMe(string Id, string Username, string Role, ApiMeKey? Key);

public sealed record ApiMeKey(string Id, string Name, IReadOnlyList<string> Scopes);

/// <summary>
/// <c>/api/v1</c>: the public task API (PL-137). Plain JSON for scripts, Home Assistant, the CLI
/// and other tools; the apps keep using <c>/api/sync</c>. v1 only ever gains fields and routes.
/// </summary>
public static class TaskApiEndpoints
{
    /// <summary>Rate limits per key, or per account for a session.</summary>
    public const string ReadRateLimit = "api-v1-read";
    public const string WriteRateLimit = "api-v1-write";
    public const int ReadsPerMinute = 600;
    public const int WritesPerMinute = 120;

    public static RouteGroupBuilder MapTaskApi(this RouteGroupBuilder v1)
    {
        v1.MapGet("/me", async (ClaimsPrincipal user, IApiKeyStore keys, CancellationToken cancellation) =>
        {
            ApiMeKey? key = null;
            if (user.ByKey() && user.FindFirstValue(ApiKeyAuth.KeyClaim) is { } keyId)
            {
                var stored = await keys.FindAsync(keyId, cancellation);
                key = new ApiMeKey(keyId, stored?.Name ?? "", [.. user.FindAll(ApiKeyAuth.ScopeClaim).Select(claim => claim.Value)]);
            }
            return Results.Ok(new ApiMe(user.UserId(), user.FindFirstValue(ClaimTypes.Name) ?? "", user.FindFirstValue(ClaimTypes.Role) ?? "user", key));
        }).Read<ApiMe>("Who is calling: the account, its role, and the key when it is one");

        v1.MapGet("/lists", async (bool? archived, ClaimsPrincipal user, TaskQueries queries, CancellationToken cancellation) =>
            Results.Ok(new ApiItems<ApiList>(await queries.ListsAsync(user.UserId(), archived ?? false, cancellation))))
            .Read<ApiItems<ApiList>>("The lists you can see (archived ones with archived=true)");

        v1.MapGet("/lists/{id}", async (string id, ClaimsPrincipal user, TaskQueries queries, CancellationToken cancellation) =>
            await queries.ListAsync(user.UserId(), id, cancellation) is { } list ? Results.Ok(list) : ApiProblems.NotFound("list", id))
            .Read<ApiList>("One list", notFound: true);

        v1.MapGet("/sections", async (string? listId, ClaimsPrincipal user, TaskQueries queries, CancellationToken cancellation) =>
            Results.Ok(new ApiItems<ApiSection>(await queries.SectionsAsync(user.UserId(), listId, cancellation))))
            .Read<ApiItems<ApiSection>>("The sections you can see, of one list with listId");

        v1.MapGet("/tags", async (ClaimsPrincipal user, TaskQueries queries, CancellationToken cancellation) =>
            Results.Ok(new ApiItems<ApiTag>(await queries.TagListAsync(user.UserId(), cancellation))))
            .Read<ApiItems<ApiTag>>("Your tags");

        v1.MapGet("/people", async (ClaimsPrincipal user, TaskWrites writes, CancellationToken cancellation) =>
            Results.Ok(new ApiItems<ApiPerson>(await writes.PeopleAsync(user.UserId(), cancellation))))
            .Read<ApiItems<ApiPerson>>("The people and groups a task's assignees can name, with their names");

        v1.MapGet("/tasks", async (HttpContext context, ClaimsPrincipal user, TaskQueries queries, CancellationToken cancellation) =>
        {
            var query = context.Request.Query;
            string? One(string name) => query[name].FirstOrDefault() is { Length: > 0 } value ? value : null;
            var known = new HashSet<string>(StringComparer.Ordinal) { "listId", "sectionId", "parentId", "status", "tag", "dueBefore", "dueAfter", "deleted", "limit", "cursor" };
            if (query.Keys.FirstOrDefault(key => !known.Contains(key)) is { } unknown)
            {
                return ApiProblems.Invalid($"unknown query parameter '{unknown}'", new Dictionary<string, string[]> { [unknown] = ["not a filter of this route"] });
            }
            var limit = TaskQueries.DefaultPage;
            if (One("limit") is { } text && !int.TryParse(text, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out limit))
            {
                return ApiProblems.Invalid($"limit must be 1 to {TaskQueries.MaxPage}");
            }
            bool deleted = false;
            if (One("deleted") is { } flag && !bool.TryParse(flag, out deleted)) return ApiProblems.Invalid("deleted must be true or false");
            var status = One("status") ?? "open";
            var filter = new TaskFilter
            {
                ListId = One("listId"),
                SectionId = One("sectionId"),
                ParentId = One("parentId"),
                Status = status == "all" ? null : status,
                Tag = One("tag"),
                DueBefore = One("dueBefore"),
                DueAfter = One("dueAfter"),
                Deleted = deleted,
            };
            try
            {
                return Results.Ok(await queries.TasksAsync(user.UserId(), filter, limit, One("cursor"), cancellation));
            }
            catch (ApiBadRequest bad)
            {
                return ApiProblems.Result(StatusCodes.Status400BadRequest, bad.Code, bad.Message);
            }
        }).Read<ApiPage<ApiTask>>("Tasks, filtered, a page at a time (next is the cursor for the following page)", badRequest: true);

        v1.MapGet("/tasks/{id}", async (string id, ClaimsPrincipal user, TaskQueries queries, CancellationToken cancellation) =>
            await queries.TaskAsync(user.UserId(), id, cancellation) is { } task ? Results.Ok(task) : ApiProblems.NotFound("task", id))
            .Read<ApiTask>("One task", notFound: true);

        v1.MapGet("/changes", async (string? cursor, string? limit, ClaimsPrincipal user, TaskQueries queries, CancellationToken cancellation) =>
        {
            var after = 0L;
            if (cursor is { Length: > 0 } && !long.TryParse(cursor, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out after))
            {
                return ApiProblems.Result(StatusCodes.Status400BadRequest, "invalid_cursor", "not a cursor from this API");
            }
            var take = TaskQueries.MaxPage;
            if (limit is { Length: > 0 } && !int.TryParse(limit, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out take))
            {
                return ApiProblems.Invalid($"limit must be 1 to {TaskQueries.MaxPage}");
            }
            try
            {
                return Results.Ok(await queries.ChangesAsync(user.UserId(), after, take, cancellation));
            }
            catch (ApiBadRequest bad)
            {
                return ApiProblems.Result(StatusCodes.Status400BadRequest, bad.Code, bad.Message);
            }
        }).Read<ApiChanges>("What changed since a cursor: tasks, lists, sections, tags, and ids you lost sight of", badRequest: true);

        v1.MapPost("/tasks", (HttpContext context, ClaimsPrincipal user, TaskWrites writes, CancellationToken cancellation) =>
            WithBody(context, body => writes.CreateTaskAsync(user.UserId(), body, cancellation))).Write<ApiTaskInput, ApiTask>("Make a task (the same id again answers 200 with the task as it is)", StatusCodes.Status201Created);
        v1.MapPost("/tasks/quick", (HttpContext context, ClaimsPrincipal user, TaskWrites writes, CancellationToken cancellation) =>
            WithBody(context, body => writes.QuickAddAsync(user.UserId(), body, cancellation))).Write<ApiQuickAddInput, TaskWrites.QuickAddAnswer>("Make a task from a line of text, read as the app's quick add reads it", StatusCodes.Status201Created).Problems(StatusCodes.Status503ServiceUnavailable);
        v1.MapPatch("/tasks/{id}", (string id, HttpContext context, ClaimsPrincipal user, TaskWrites writes, CancellationToken cancellation) =>
            WithBody(context, body => writes.UpdateTaskAsync(user.UserId(), id, body, cancellation))).Write<ApiTaskInput, ApiTask>("Change a task's fields; the ones left out are left alone");
        v1.MapPost("/tasks/{id}/complete", (string id, HttpContext context, ClaimsPrincipal user, TaskWrites writes, CancellationToken cancellation) =>
            WithBody(context, body =>
            {
                var unknown = body.Select(pair => pair.Key).FirstOrDefault(key => key != "status");
                if (unknown is not null) return Task.FromResult(ApiProblems.Invalid($"'{unknown}' is not a field here"));
                var status = body["status"] is null ? "done" : (string?)(body["status"] as System.Text.Json.Nodes.JsonValue);
                return status is "done" or "wontdo"
                    ? writes.CompleteAsync(user.UserId(), id, status, cancellation)
                    : Task.FromResult(ApiProblems.Invalid("status must be done or wontdo", new Dictionary<string, string[]> { ["status"] = ["must be done or wontdo"] }));
            }, optional: true)).Write<ApiCompleteInput, CompleteResult>("Close a task; a repeating one moves on to its next date, answered as next");
        v1.MapPost("/tasks/{id}/reopen", (string id, ClaimsPrincipal user, TaskWrites writes, CancellationToken cancellation) =>
            writes.ReopenAsync(user.UserId(), id, cancellation)).Write<ApiTask>("Open a closed task again");
        v1.MapDelete("/tasks/{id}", (string id, ClaimsPrincipal user, TaskWrites writes, CancellationToken cancellation) =>
            writes.DeleteAsync(user.UserId(), id, cancellation)).Write("Delete a task and its subtasks (restore brings them back)");
        v1.MapPost("/tasks/{id}/restore", (string id, ClaimsPrincipal user, TaskWrites writes, CancellationToken cancellation) =>
            writes.RestoreAsync(user.UserId(), id, cancellation)).Write<ApiTask>("Bring back a deleted task and what went with it");

        v1.MapPost("/lists", (HttpContext context, ClaimsPrincipal user, TaskWrites writes, CancellationToken cancellation) =>
            WithBody(context, body => writes.CreateListAsync(user.UserId(), body, cancellation))).Write<ApiListInput, ApiList>("Make a list", StatusCodes.Status201Created);
        v1.MapPatch("/lists/{id}", (string id, HttpContext context, ClaimsPrincipal user, TaskWrites writes, CancellationToken cancellation) =>
            WithBody(context, body => writes.UpdateListAsync(user.UserId(), id, body, cancellation))).Write<ApiListInput, ApiList>("Rename or recolor a list (its owner only)");
        v1.MapPost("/sections", (HttpContext context, ClaimsPrincipal user, TaskWrites writes, CancellationToken cancellation) =>
            WithBody(context, body => writes.CreateSectionAsync(user.UserId(), body, cancellation))).Write<ApiSectionInput, ApiSection>("Make a section in a list", StatusCodes.Status201Created);
        v1.MapPatch("/sections/{id}", (string id, HttpContext context, ClaimsPrincipal user, TaskWrites writes, CancellationToken cancellation) =>
            WithBody(context, body => writes.UpdateSectionAsync(user.UserId(), id, body, cancellation))).Write<ApiSectionInput, ApiSection>("Rename a section");

        return v1;
    }

    // OpenAPI: what each route answers, and the problems it can answer with.

    private const string ProblemType = "application/problem+json";

    private static RouteHandlerBuilder Problems(this RouteHandlerBuilder route, params int[] statuses)
    {
        int[] always = [StatusCodes.Status401Unauthorized, StatusCodes.Status403Forbidden, StatusCodes.Status429TooManyRequests];
        foreach (var status in statuses.Concat(always).Distinct()) route.Produces<ApiProblems.Problem>(status, ProblemType);
        return route;
    }

    private static RouteHandlerBuilder Read<T>(this RouteHandlerBuilder route, string summary, bool notFound = false, bool badRequest = false)
    {
        var problems = new List<int>();
        if (notFound) problems.Add(StatusCodes.Status404NotFound);
        if (badRequest) problems.Add(StatusCodes.Status400BadRequest);
        return route.RequireRateLimiting(ReadRateLimit).WithSummary(summary).Produces<T>().Problems([.. problems]);
    }

    private static RouteHandlerBuilder Write<TBody, T>(this RouteHandlerBuilder route, string summary, int status = StatusCodes.Status200OK) where TBody : notnull
    {
        // Described, not enforced: Accepts would also make routing match on the Content-Type.
        route.WithMetadata(new ApiDocs.Body(typeof(TBody), Optional: typeof(TBody) == typeof(ApiCompleteInput))).Write<T>(summary, status);
        // A create with an id that exists already answers 200 with it.
        if (status == StatusCodes.Status201Created) route.Produces<T>();
        return route;
    }

    private static RouteHandlerBuilder Write<T>(this RouteHandlerBuilder route, string summary, int status = StatusCodes.Status200OK) =>
        route.RequireRateLimiting(WriteRateLimit).WithSummary(summary).Produces<T>(status).WriteProblems();

    private static RouteHandlerBuilder Write(this RouteHandlerBuilder route, string summary) =>
        route.RequireRateLimiting(WriteRateLimit).WithSummary(summary).Produces(StatusCodes.Status204NoContent).WriteProblems();

    private static RouteHandlerBuilder WriteProblems(this RouteHandlerBuilder route) =>
        route.Problems(StatusCodes.Status400BadRequest, StatusCodes.Status404NotFound, StatusCodes.Status409Conflict, StatusCodes.Status413PayloadTooLarge);

    /// <summary>The most a write's body may be.</summary>
    public const int MaxBodyBytes = 1024 * 1024;

    /// <summary>
    /// The request's JSON object, or the problem with it: not JSON, not an object, or too large.
    /// <paramref name="optional"/>: an empty body counts as <c>{}</c>.
    /// </summary>
    private static async Task<IResult> WithBody(HttpContext context, Func<System.Text.Json.Nodes.JsonObject, Task<IResult>> then, bool optional = false)
    {
        if (context.Request.ContentLength > MaxBodyBytes) return ApiProblems.Result(StatusCodes.Status413PayloadTooLarge, "too_large", $"at most {MaxBodyBytes / 1024} KB");
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while ((read = await context.Request.Body.ReadAsync(chunk, context.RequestAborted)) > 0)
        {
            if (buffer.Length + read > MaxBodyBytes) return ApiProblems.Result(StatusCodes.Status413PayloadTooLarge, "too_large", $"at most {MaxBodyBytes / 1024} KB");
            buffer.Write(chunk, 0, read);
        }
        if (buffer.Length == 0 && optional) return await then([]);
        try
        {
            return System.Text.Json.Nodes.JsonNode.Parse(buffer.ToArray()) is System.Text.Json.Nodes.JsonObject body
                ? await then(body)
                : ApiProblems.Invalid("the body must be a JSON object");
        }
        catch (System.Text.Json.JsonException)
        {
            return ApiProblems.Invalid("the body is not valid JSON");
        }
    }
}
