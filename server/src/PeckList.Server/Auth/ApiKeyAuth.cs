using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using PeckList.Core.Accounts;
using PeckList.Server.Audit;

namespace PeckList.Server.Auth;

/// <summary>
/// API keys (R-FB-157): <c>Authorization: Bearer pl_...</c> signs a request in as the key's owner,
/// with only what the key was given. Keys are for the HTTP API: they never sign in to the app,
/// make or revoke keys, change an account or sign anyone in; any path not named here is refused.
/// </summary>
public static class ApiKeyAuth
{
    public const string Scheme = "apikey";
    /// <summary>Picks the key scheme for a bearer key, else the session cookie.</summary>
    public const string Auto = "pecklist";
    public const string ScopeClaim = "pecklist:scope";
    public const string KeyClaim = "pecklist:key";

    public static bool ByKey(this ClaimsPrincipal user) => user.Identity?.AuthenticationType == Scheme;

    public static bool KeyMay(this ClaimsPrincipal user, string scope) => user.HasClaim(ScopeClaim, scope);

    public static AuthenticationBuilder AddApiKeys(this AuthenticationBuilder authentication)
    {
        authentication.AddPolicyScheme(Auto, "Session or API key", options =>
            options.ForwardDefaultSelector = context =>
                BearerToken(context.Request) is not null ? Scheme : CookieAuthenticationDefaults.AuthenticationScheme);
        authentication.AddScheme<AuthenticationSchemeOptions, Handler>(Scheme, _ => { });
        return authentication;
    }

    private static string? BearerToken(HttpRequest request)
    {
        var header = request.Headers.Authorization.ToString();
        return header.StartsWith("Bearer " + ApiKeyService.Prefix, StringComparison.Ordinal) ? header["Bearer ".Length..].Trim() : null;
    }

    private sealed class Handler(
        IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder,
        ApiKeyService keys, IApiKeyStore store, IAccountStore accounts, RoleLeases leases, IMemoryCache cache, TimeProvider time)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (BearerToken(Request) is not { } token) return AuthenticateResult.NoResult();
            var key = await keys.CheckAsync(token, Context.RequestAborted);
            if (key is null) return AuthenticateResult.Fail("unknown, revoked or expired key");
            var account = await accounts.FindByIdAsync(key.UserId, Context.RequestAborted);
            if (account is null || account.Disabled) return AuthenticateResult.Fail("the key's account cannot sign in");
            // A key acts with its account's role: one from ROLE_MAP nobody renewed in time goes first.
            account = await leases.CheckAsync(account, Context.RequestAborted);
            // Last used: kept to within a few minutes, not written on every request.
            if (cache.TryGetValue($"key-used:{key.Id}", out _) is false)
            {
                cache.Set($"key-used:{key.Id}", true, TimeSpan.FromMinutes(5));
                await store.TouchAsync(key.Id, time.GetUtcNow(), Context.RequestAborted);
            }
            var session = AuthSetup.Principal(account with { MustChangePassword = false }, ApiKeyAuth.Scheme, ApiKeyAuth.Scheme);
            var identity = (ClaimsIdentity)session.Identity!;
            identity.AddClaim(new Claim(KeyClaim, key.Id));
            identity.AddClaims(key.Scopes.Select(scope => new Claim(ScopeClaim, scope)));
            return AuthenticateResult.Success(new AuthenticationTicket(session, ApiKeyAuth.Scheme));
        }

        protected override Task HandleChallengeAsync(AuthenticationProperties properties)
        {
            Response.StatusCode = StatusCodes.Status401Unauthorized;
            Response.Headers.WWWAuthenticate = "Bearer";
            return Task.CompletedTask;
        }
    }

    /// <summary>
    /// What a key needs for a request, or null when keys may not make it at all. Sync pulls with
    /// <see cref="ApiScopes.TasksRead"/>; pushing changes also needs <see cref="ApiScopes.TasksWrite"/>
    /// (checked by the sync endpoint, which reads the body).
    /// </summary>
    /// <summary>A route any working key may use, whatever its scopes.</summary>
    public const string AnyScope = "*";

    public static string? ScopeFor(string method, PathString path)
    {
        var get = HttpMethods.IsGet(method) || HttpMethods.IsHead(method);
        if (path.Equals("/api/sync")) return HttpMethods.IsPost(method) ? ApiScopes.TasksRead : null;
        if (path.Equals("/api/events")) return get ? ApiScopes.TasksRead : null;
        if (path.StartsWithSegments("/api/tasks") && path.Value!.EndsWith("/history", StringComparison.Ordinal)) return get ? ApiScopes.TasksRead : null;
        if (path.StartsWithSegments("/api/attachments")) return get ? ApiScopes.FilesRead : HttpMethods.IsPut(method) ? ApiScopes.FilesWrite : null;
        if (path.StartsWithSegments("/api/notifications")) return ApiScopes.Notifications;
        if (path.StartsWithSegments("/api/admin")) return ApiScopes.Admin;
        // The task API (PL-137): reads with tasks:read, writes with tasks:write; who am I with any key.
        if (path.Equals("/api/v1/me")) return get ? AnyScope : null;
        // Signing the CLI in is never a key's (approving makes keys); signing out is any key's own.
        if (path.StartsWithSegments("/api/v1/cli")) return path.Equals("/api/v1/cli/sign-in") && HttpMethods.IsDelete(method) ? AnyScope : null;
        if (path.StartsWithSegments("/api/v1"))
        {
            if (get) return ApiScopes.TasksRead;
            return HttpMethods.IsPost(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method) ? ApiScopes.TasksWrite : null;
        }
        return null;
    }

    /// <summary>Requests signed in by a key go only where its scopes reach (fail closed).</summary>
    public static void UseApiKeyScopes(this WebApplication app) => app.Use(async (context, next) =>
    {
        var path = context.Request.Path;
        if (context.User.ByKey() && !path.Equals("/api/info"))
        {
            var scope = path.StartsWithSegments("/api") ? ScopeFor(context.Request.Method, path) : null;
            if (scope is null || (scope != AnyScope && !context.User.KeyMay(scope)))
            {
                var message = scope is null ? "API keys cannot use this" : $"this key lacks the {scope} permission";
                if (Api.ApiProblems.IsV1(path))
                {
                    await Api.ApiProblems.WriteAsync(context, StatusCodes.Status403Forbidden, "scope", message);
                    return;
                }
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new
                {
                    error = "scope",
                    message,
                });
                return;
            }
        }
        await next(context);
    });

    /// <summary>
    /// <c>/api/account/api-keys</c>: a person's own keys. List (no secrets), make one (its token is in
    /// the answer, once), revoke one. Only a signed-in session does this, never a key.
    /// </summary>
    public static RouteGroupBuilder MapApiKeys(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/account/api-keys");
        group.MapGet("", async (ClaimsPrincipal user, ApiKeyService keys, CancellationToken cancellation) =>
            (await keys.ListAsync(user.UserId(), cancellation)).Select(View));
        group.MapPost("", async (NewKey request, ClaimsPrincipal user, ApiKeyService keys, AuditLog audit, HttpContext context, CancellationToken cancellation) =>
        {
            try
            {
                var (key, token) = await keys.CreateAsync(user.UserId(), user.AccountRole(), request.Name ?? "", request.Scopes ?? [],
                    request.ExpiresAt, cancellation);
                audit.RecordEvent(context, "account.api-key-created", user.UserId(), user.FindFirstValue(ClaimTypes.Name),
                    key.Id, key.Name, string.Join(' ', key.Scopes));
                return Results.Ok(new CreatedKey(View(key), token));
            }
            catch (ApiKeyRejected rejected)
            {
                return Results.BadRequest(new { error = "invalid", message = $"An API key needs {rejected.Message}." });
            }
        });
        group.MapDelete("/{id}", async (string id, ClaimsPrincipal user, ApiKeyService keys, AuditLog audit, HttpContext context, CancellationToken cancellation) =>
        {
            if (!await keys.RevokeAsync(user.UserId(), id, cancellation)) return Results.NotFound();
            audit.RecordEvent(context, "account.api-key-revoked", user.UserId(), user.FindFirstValue(ClaimTypes.Name), id, null, null);
            return Results.NoContent();
        });
        return api;
    }

    private static KeyView View(ApiKey key) =>
        new(key.Id, key.Name, key.Scopes, key.CreatedAt, key.ExpiresAt, key.LastUsedAt, key.RevokedAt);

    public sealed record NewKey(string? Name, IReadOnlyList<string>? Scopes, DateTimeOffset? ExpiresAt);

    public sealed record KeyView(
        string Id, string Name, IReadOnlyList<string> Scopes, DateTimeOffset CreatedAt, DateTimeOffset? ExpiresAt,
        DateTimeOffset? LastUsedAt, DateTimeOffset? RevokedAt);

    public sealed record CreatedKey(KeyView Key, string Token);
}

/// <summary>Clears revoked API keys once they are a week old, every hour.</summary>
public sealed class ApiKeyRetention(ApiKeyService keys, TimeProvider time, ILogger<ApiKeyRetention> logger)
    : PeriodicService("Clearing revoked API keys", TimeSpan.FromSeconds(30), TimeSpan.FromHours(1), time, logger, LogLevel.Warning)
{
    protected override async Task RunAsync(CancellationToken stopping)
    {
        var gone = await keys.ClearRevokedAsync(stopping);
        if (gone > 0) Logger.LogInformation("Cleared {Count} revoked API keys", gone);
    }
}
