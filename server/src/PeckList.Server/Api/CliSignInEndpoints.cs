using System.Security.Claims;
using PeckList.Core.Accounts;
using PeckList.Server.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server.Api;

public sealed record CliStartRequest(string? Name, bool? Admin);

/// <summary>A sign-in started: the code the person types, where, and the CLI's secret for polling.</summary>
public sealed record CliStarted(string UserCode, string? ApproveUrl, string PollToken, int Interval, int ExpiresIn);

public sealed record CliPollRequest(string? PollToken);

/// <summary>The key the CLI collects, once.</summary>
public sealed record CliCollected(string Token, ApiMeKey Key);

public sealed record CliCodeRequest(string? UserCode, bool? Admin);

/// <summary>What the <c>/cli</c> page shows before Approve: which terminal asked, when, and from where.</summary>
public sealed record CliRequestView(
    string UserCode, string Name, DateTimeOffset RequestedAt, string? Address, string? YourAddress, bool AdminAsked, bool MayGrantAdmin);

public sealed record CliApproved(string KeyName, IReadOnlyList<string> Scopes);

/// <summary>
/// <c>/api/v1/cli</c>: signing the command line in (PL-133). Starting and polling take no
/// sign-in (rate limited per address); looking a code up, approving and denying take a signed-in
/// session only: never a key, never while viewing as someone, never before a required password
/// change. Signing out revokes the calling key, from the request's own credentials.
/// </summary>
public static class CliSignInEndpoints
{
    public const string StartRateLimit = "cli-sign-in";
    public const string PollRateLimit = "cli-poll";
    public const int StartsPerMinute = 10;
    public const int PollsPerMinute = 60;

    public static void MapCliSignIn(this WebApplication app)
    {
        var cli = app.MapGroup("/api/v1/cli").WithTags("v1: cli");

        cli.MapPost("/sign-in", async (CliStartRequest? request, HttpContext context, CliSignIns signIns, CancellationToken cancellation) =>
        {
            var started = await signIns.StartAsync(request?.Name, request?.Admin == true, Address(context), cancellation);
            if (started is null) return ApiProblems.Result(StatusCodes.Status503ServiceUnavailable, "busy", "too many sign-ins are waiting; try again in a few minutes");
            var origin = ServerApp.LinkOrigin(context);
            return Results.Ok(new CliStarted(
                started.UserCode,
                origin is null ? null : $"{origin}/cli",
                started.PollToken,
                (int)CliSignIns.Interval.TotalSeconds,
                (int)CliSignIns.Lifetime.TotalSeconds));
        })
            .AllowAnonymous().RequireRateLimiting(StartRateLimit)
            .WithSummary("Start signing the command line in: a code to type on the /cli page, and a token to poll with")
            .Produces<CliStarted>().Produces<ApiProblems.Problem>(StatusCodes.Status429TooManyRequests, "application/problem+json")
            .ProblemAt(StatusCodes.Status503ServiceUnavailable);

        cli.MapPost("/sign-in/poll", async (CliPollRequest? request, CliSignIns signIns, CancellationToken cancellation) =>
        {
            var (result, token, key) = await signIns.PollAsync(request?.PollToken, cancellation);
            return result switch
            {
                CliSignIns.Poll.Approved => Results.Ok(new CliCollected(token!, new ApiMeKey(key!.Id, key.Name, key.Scopes))),
                CliSignIns.Poll.Pending => ApiProblems.Result(StatusCodes.Status428PreconditionRequired, "pending", "not approved yet; poll again after the interval"),
                CliSignIns.Poll.SlowDown => ApiProblems.Result(StatusCodes.Status429TooManyRequests, "slow_down", "poll no more often than the interval"),
                CliSignIns.Poll.Denied => ApiProblems.Result(StatusCodes.Status403Forbidden, "denied", "the sign-in was denied"),
                _ => ApiProblems.Result(StatusCodes.Status410Gone, "expired", "no such sign-in: it ran out, was collected, or the server restarted"),
            };
        })
            .AllowAnonymous().RequireRateLimiting(PollRateLimit)
            .WithSummary("Poll a sign-in: 428 pending, 429 slow_down, 403 denied, 410 expired, or the key once")
            .Produces<CliCollected>()
            .ProblemAt(StatusCodes.Status403Forbidden, StatusCodes.Status410Gone, StatusCodes.Status428PreconditionRequired, StatusCodes.Status429TooManyRequests);

        cli.MapPost("/lookup", (CliCodeRequest? request, ClaimsPrincipal user, HttpContext context, CliSignIns signIns) =>
        {
            if (SessionOnly(user) is { } refused) return refused;
            var (result, found) = signIns.Find(user.UserId(), request?.UserCode);
            if (result != CliSignIns.Lookup.Found) return CodeProblem(result);
            return Results.Ok(View(found!, user, context));
        })
            .RequireAuthorization().RequireRateLimiting(AuthSetup.AccountRateLimit)
            .WithSummary("The sign-in a code names: the terminal's name, when and from where it asked")
            .Produces<CliRequestView>()
            .ProblemAt(StatusCodes.Status403Forbidden, StatusCodes.Status404NotFound, StatusCodes.Status429TooManyRequests);

        cli.MapPost("/approve", async (CliCodeRequest? request, ClaimsPrincipal user, HttpContext context, CliSignIns signIns, AuditLog audit,
            CancellationToken cancellation) =>
        {
            if (SessionOnly(user) is { } refused) return refused;
            var (result, found) = signIns.Find(user.UserId(), request?.UserCode);
            if (result != CliSignIns.Lookup.Found) return CodeProblem(result);
            ApiKey? key;
            try
            {
                key = await signIns.ApproveAsync(found!, user.UserId(), user.AccountRole(), request?.Admin == true, cancellation);
            }
            catch (ApiKeyRejected rejected)
            {
                return ApiProblems.Result(StatusCodes.Status409Conflict, "key_refused", $"An API key needs {rejected.Message}.");
            }
            if (key is null) return CodeProblem(CliSignIns.Lookup.NotFound);
            audit.RecordEvent(context, "account.api-key-created", user.UserId(), user.FindFirstValue(ClaimTypes.Name), key.Id, key.Name,
                $"{string.Join(' ', key.Scopes)}; command line sign-in asked from {found!.Address ?? "unknown"}, approved from {Address(context) ?? "unknown"}");
            return Results.Ok(new CliApproved(key.Name, key.Scopes));
        })
            .RequireAuthorization().RequireRateLimiting(AuthSetup.AccountRateLimit)
            .WithSummary("Approve a sign-in: makes the CLI's API key")
            .Produces<CliApproved>()
            .ProblemAt(StatusCodes.Status403Forbidden, StatusCodes.Status404NotFound, StatusCodes.Status409Conflict, StatusCodes.Status429TooManyRequests);

        cli.MapPost("/deny", (CliCodeRequest? request, ClaimsPrincipal user, CliSignIns signIns) =>
        {
            if (SessionOnly(user) is { } refused) return refused;
            var (result, found) = signIns.Find(user.UserId(), request?.UserCode);
            if (result != CliSignIns.Lookup.Found) return CodeProblem(result);
            signIns.Deny(found!);
            return Results.NoContent();
        })
            .RequireAuthorization().RequireRateLimiting(AuthSetup.AccountRateLimit)
            .Doc("Deny a sign-in")
            .ProblemAt(StatusCodes.Status403Forbidden, StatusCodes.Status404NotFound, StatusCodes.Status429TooManyRequests);

        cli.MapDelete("/sign-in", async (ClaimsPrincipal user, HttpContext context, ApiKeyService keys, AuditLog audit, CancellationToken cancellation) =>
        {
            // The key from this request's own credentials: never an id from a body or the path.
            if (!user.ByKey() || user.FindFirstValue(ApiKeyAuth.KeyClaim) is not { } keyId)
            {
                return ApiProblems.Result(StatusCodes.Status403Forbidden, "key_only", "signing out revokes the key the request is signed in with; a session signs out at /auth/logout");
            }
            await keys.RevokeAsync(user.UserId(), keyId, cancellation);
            audit.RecordEvent(context, "account.api-key-revoked", user.UserId(), user.FindFirstValue(ClaimTypes.Name), keyId, null, "command line sign-out");
            return Results.NoContent();
        })
            .RequireAuthorization()
            .Doc("Sign the command line out: revokes the key this request is signed in with")
            .ProblemAt(StatusCodes.Status403Forbidden);
    }

    private static string? Address(HttpContext context) => context.Connection.RemoteIpAddress?.ToString();

    /// <summary>Approving makes a key: only a person signed in to the web app, as themselves, may.</summary>
    private static IResult? SessionOnly(ClaimsPrincipal user) =>
        user.ByKey() ? ApiProblems.Result(StatusCodes.Status403Forbidden, "scope", "an API key cannot approve a sign-in")
        : user.Impersonator() is not null ? ApiProblems.Result(StatusCodes.Status403Forbidden, "not_while_impersonating", "not while viewing as someone")
        : user.MustChangePassword() ? ApiProblems.Result(StatusCodes.Status403Forbidden, "password_change_required", "change your password first")
        : null;

    private static IResult CodeProblem(CliSignIns.Lookup result) => result == CliSignIns.Lookup.TooManyTries
        ? ApiProblems.Result(StatusCodes.Status429TooManyRequests, "too_many_tries", "too many wrong codes; wait a few minutes")
        : ApiProblems.Result(StatusCodes.Status404NotFound, "not_found", "no sign-in is waiting with this code");

    private static CliRequestView View(CliSignIns.Request request, ClaimsPrincipal user, HttpContext context) => new(
        CliSignIns.Display(request.Code), request.Name, request.RequestedAt, request.Address, Address(context),
        request.AdminAsked, request.AdminAsked && user.AccountRole() != Role.User);
}
