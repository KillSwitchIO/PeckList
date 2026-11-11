namespace PeckList.Server.Api;

/// <summary>
/// The task API's errors (PL-137): <c>application/problem+json</c> with a stable <c>code</c>, and
/// for a bad body the problem with each field in <c>errors</c>.
/// </summary>
public static class ApiProblems
{
    public const string ContentType = "application/problem+json";

    private static readonly Dictionary<int, string> Titles = new()
    {
        [400] = "Bad request",
        [401] = "Not signed in",
        [403] = "Not allowed",
        [404] = "Not found",
        [409] = "Conflict",
        [413] = "Too large",
        [429] = "Too many requests",
        [503] = "Starting",
    };

    /// <summary>The problem document every v1 error has.</summary>
    public sealed record Problem(string Type, string Title, int Status, string Code, string Detail, IReadOnlyDictionary<string, string[]>? Errors = null);

    public static Problem Of(int status, string code, string detail, IReadOnlyDictionary<string, string[]>? errors = null) =>
        new("about:blank", Titles.GetValueOrDefault(status, "Error"), status, code, detail, errors);

    public static IResult Result(int status, string code, string detail, IReadOnlyDictionary<string, string[]>? errors = null) =>
        Results.Json(Of(status, code, detail, errors), contentType: ContentType, statusCode: status);

    public static IResult NotFound(string what, string id) =>
        Result(StatusCodes.Status404NotFound, "not_found", $"no {what} {id} that you can see");

    public static IResult Invalid(string detail, IReadOnlyDictionary<string, string[]>? errors = null) =>
        Result(StatusCodes.Status400BadRequest, "invalid_request", detail, errors);

    public static IResult Forbidden(string detail) => Result(StatusCodes.Status403Forbidden, "forbidden", detail);

    /// <summary>Writes a problem straight to the response (middleware, where there is no endpoint result).</summary>
    public static Task WriteAsync(HttpContext context, int status, string code, string detail)
    {
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(Of(status, code, detail), (System.Text.Json.JsonSerializerOptions?)null, ContentType, context.RequestAborted);
    }

    /// <summary>Under <c>/api/v1</c>: the task API, whose errors are all problems.</summary>
    public static bool IsV1(PathString path) => path.StartsWithSegments("/api/v1");

    /// <summary>
    /// A bare 401 or 429 from the sign-in or rate-limit middleware becomes a problem, so a client
    /// never has to read two error shapes.
    /// </summary>
    public static void UseApiProblems(this WebApplication app) => app.Use(async (context, next) =>
    {
        if (!IsV1(context.Request.Path))
        {
            await next(context);
            return;
        }
        await next(context);
        if (context.Response.HasStarted || context.Response.ContentLength > 0 || context.Response.ContentType is not null) return;
        switch (context.Response.StatusCode)
        {
            case StatusCodes.Status401Unauthorized:
                await WriteAsync(context, 401, "unauthorized", "sign in, or send a working API key as a Bearer token");
                break;
            case StatusCodes.Status403Forbidden:
                await WriteAsync(context, 403, "forbidden", "you may not do this");
                break;
            case StatusCodes.Status429TooManyRequests:
                await WriteAsync(context, 429, "rate_limited", "too many requests; wait as Retry-After says");
                break;
            case StatusCodes.Status503ServiceUnavailable:
                await WriteAsync(context, 503, "starting", "the server is starting; try again shortly");
                break;
        }
    });
}
