using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Threading.RateLimiting;
using System.Xml.Linq;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;

namespace PeckList.Server.Auth;

/// <summary>
/// Who is calling. <c>AUTH_MODE=local</c>: an HttpOnly session cookie, checked against the account's
/// security stamp so a password change or a disabled account ends every session. <c>none</c>: every
/// request is the one admin.
/// </summary>
public static class AuthSetup
{
    public const string NoLoginScheme = "none";
    public const string LoginRateLimit = "login";
    public const string StampClaim = "stamp";
    public const string MustChangeClaim = "must_change_password";

    /// <summary>How the session was made: <see cref="ByPassword"/>, <see cref="ByProvider"/>, <see cref="ByLink"/> or <see cref="ByPasskey"/>.</summary>
    public const string MethodClaim = "pecklist:method";

    public const string ByPassword = "password";
    public const string ByProvider = "provider";
    public const string ByLink = "link";
    public const string ByPasskey = "passkey";

    public static IServiceCollection AddPeckListAuth(this IServiceCollection services, ServerSettings settings)
    {
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<IPasswordHasher, AspNetPasswordHasher>();
        services.AddSingleton(provider => new AccountService(
            provider.GetRequiredService<IAccountStore>(), provider.GetRequiredService<IPasswordHasher>(), provider.GetRequiredService<TimeProvider>())
        {
            DemoUsernames = settings.DemoMode ? settings.DemoAccounts.Select(each => each.Username).ToHashSet(StringComparer.Ordinal) : new HashSet<string>(),
        });
        services.AddSingleton<SignUpThrottle>();
        services.AddSingleton<ExternalSignIn>();
        services.AddSingleton<LoginLinks>();
        services.AddSingleton<AccountEmails>();
        services.AddSingleton<ProviderIcons>();
        services.AddSingleton<SignupInvites>();
        services.AddSingleton<SelfSignUp>();
        services.AddSingleton<Impersonations>();
        services.AddSingleton<ApiKeyService>();
        services.AddSingleton<OwnerAccount>();
        services.AddMemoryCache();
        services.AddSingleton(new StartupConsole(Console.Out));
        services.AddHostedService<AccountStartup>();

        // Cookie keys live in the database: restarts and new containers keep sessions valid, and a
        // PostgreSQL setup needs no volume for them.
        services.AddDataProtection().SetApplicationName("pecklist");
        services.AddOptions<KeyManagementOptions>()
            .Configure<Core.Accounts.ISecretStore>((options, secrets) => options.XmlRepository = new SecretStoreXmlRepository(secrets));

        if (settings.AuthMode == AuthMode.None)
        {
            services.AddAuthentication(NoLoginScheme)
                .AddScheme<AuthenticationSchemeOptions, NoLoginHandler>(NoLoginScheme, _ => { });
        }
        else
        {
            // A bearer API key (R-FB-157) or the session cookie, whichever the request carries.
            var authentication = services.AddAuthentication(ApiKeyAuth.Auto);
            authentication.AddApiKeys();
            authentication.AddCookie(options =>
                {
                    options.Cookie.Name = "pecklist_session";
                    options.Cookie.HttpOnly = true;
                    options.Cookie.SameSite = SameSiteMode.Lax;
                    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                    options.ExpireTimeSpan = TimeSpan.FromDays(30);
                    options.SlidingExpiration = true;
                    // An API: answer 401/403 instead of redirecting to a login page.
                    options.Events.OnRedirectToLogin = context => Status(context, StatusCodes.Status401Unauthorized);
                    options.Events.OnRedirectToAccessDenied = context => Status(context, StatusCodes.Status403Forbidden);
                    options.Events.OnValidatePrincipal = ValidateStampAsync;
                });
            services.AddOidc(settings, authentication);
        }
        services.AddAuthorization(options =>
        {
            foreach (var permission in Enum.GetValues<Permission>())
            {
                options.AddPolicy(PolicyName(permission), policy => policy
                    .RequireAuthenticatedUser()
                    .RequireAssertion(context => context.User.AccountRole().Can(permission)));
            }
        });
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            // Ten tries a minute per address, on top of the per-account lockout.
            options.AddPolicy(LoginRateLimit, context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
        });
        return services;
    }

    /// <param name="method">How the person proved who they are (<see cref="MethodClaim"/>); null for requests that are no session.</param>
    public static ClaimsPrincipal Principal(Account account, string scheme, string? method = null) => new(new ClaimsIdentity(
    [
        new Claim(ClaimTypes.NameIdentifier, account.Id),
        new Claim(ClaimTypes.Name, account.Username),
        new Claim(ClaimTypes.Role, account.Role.Name()),
        new Claim(StampClaim, account.SecurityStamp),
        new Claim(MustChangeClaim, account.MustChangePassword ? "true" : "false"),
        .. method is null ? Array.Empty<Claim>() : [new Claim(MethodClaim, method)],
    ], scheme));

    /// <summary>
    /// Whether a session was made with a password. Sessions from before the method was recorded
    /// count as password sessions unless an identity provider made them.
    /// </summary>
    public static bool IsPasswordSession(ClaimsPrincipal user) =>
        user.FindFirstValue(MethodClaim) is { } method
            ? method == ByPassword
            : user.FindFirstValue(OidcSetup.ProviderClaim) is null;

    public static string UserId(this ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new InvalidOperationException("not signed in");

    public static bool MustChangePassword(this ClaimsPrincipal user) => user.FindFirstValue(MustChangeClaim) == "true";

    public static Role AccountRole(this ClaimsPrincipal user) =>
        Roles.TryParse(user.FindFirstValue(ClaimTypes.Role), out var role) ? role : Role.User;

    public static string PolicyName(Permission permission) => $"permission:{permission}";

    /// <summary>Only callers whose role has <paramref name="permission"/> (spec: Accounts &amp; Admin, Roles).</summary>
    public static TBuilder RequirePermission<TBuilder>(this TBuilder builder, Permission permission)
        where TBuilder : IEndpointConventionBuilder =>
        builder.RequireAuthorization(PolicyName(permission)).WithMetadata(new RequiresPermission(permission));

    /// <summary>Forget the cached stamp and role, e.g. right after this process changed them.</summary>
    public static void ForgetStamp(IMemoryCache cache, string accountId) => cache.Remove(StampKey(accountId));

    private static string StampKey(string accountId) => $"stamp:{accountId}";

    private static Task Status(RedirectContext<CookieAuthenticationOptions> context, int status)
    {
        context.Response.StatusCode = status;
        return Task.CompletedTask;
    }

    /// <summary>
    /// End the session when the account is gone, disabled or its stamp changed, and pick up a new
    /// role without ending it (checked at most every 30 s).
    /// </summary>
    private static async Task ValidateStampAsync(CookieValidatePrincipalContext context)
    {
        var id = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var stamp = context.Principal?.FindFirstValue(StampClaim);
        var cache = context.HttpContext.RequestServices.GetRequiredService<IMemoryCache>();
        var accounts = context.HttpContext.RequestServices.GetRequiredService<IAccountStore>();
        var current = id is null ? null : await cache.GetOrCreateAsync(StampKey(id), async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);
            var account = await accounts.FindByIdAsync(id, context.HttpContext.RequestAborted);
            return account is null || account.Disabled ? null : new SessionCheck(account.SecurityStamp, account.Role.Name());
        });
        // LOCAL_LOGIN=disabled ends password sessions at once (a live setting), not when they expire.
        var passwordsOff = context.Principal is { } session
            && context.HttpContext.RequestServices.GetRequiredService<LiveSettings>().Current.LocalLoginDisabled
            && IsPasswordSession(session);
        if (current is null || current.Stamp != stamp || passwordsOff)
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return;
        }
        var principal = context.Principal!;
        if (principal.FindFirstValue(ClaimTypes.Role) != current.Role)
        {
            var claims = principal.Claims.Where(claim => claim.Type != ClaimTypes.Role)
                .Append(new Claim(ClaimTypes.Role, current.Role));
            context.ReplacePrincipal(new ClaimsPrincipal(new ClaimsIdentity(claims, context.Scheme.Name)));
            context.ShouldRenew = true;
        }
    }

    private sealed record SessionCheck(string Stamp, string Role);

    /// <summary>Data protection keys in the <c>server_secrets</c> table.</summary>
    private sealed class SecretStoreXmlRepository(Core.Accounts.ISecretStore secrets) : IXmlRepository
    {
        private const string Kind = "dataprotection";

        // The interface is synchronous; keys are read rarely (start, then on rotation).
        public IReadOnlyCollection<XElement> GetAllElements() =>
            secrets.ListAsync(Kind).GetAwaiter().GetResult().Select(each => XElement.Parse(each.Value)).ToList();

        public void StoreElement(XElement element, string friendlyName) =>
            secrets.PutAsync(Kind, friendlyName, element.ToString(SaveOptions.DisableFormatting)).GetAwaiter().GetResult();
    }

    /// <summary>The account every request uses when AUTH_MODE is none (set at startup).</summary>
    public sealed class OwnerAccount
    {
        public Account? Account { get; set; }
    }

    private sealed class NoLoginHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder, OwnerAccount owner)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync() =>
            Task.FromResult(owner.Account is null
                ? AuthenticateResult.Fail("server still starting")
                : AuthenticateResult.Success(new AuthenticationTicket(Principal(owner.Account with { MustChangePassword = false }, NoLoginScheme), NoLoginScheme)));
    }

    /// <summary>After migrations: the admin (local) or the owner (none).</summary>
    private sealed class AccountStartup(
        AccountService accounts, ServerSettings settings, OwnerAccount owner, StartupConsole console, ILogger<AccountStartup> logger)
        : IHostedService
    {
        public async Task StartAsync(CancellationToken cancellation)
        {
            if (settings.AuthMode == AuthMode.None)
            {
                owner.Account = await accounts.EnsureOwnerAsync(cancellation);
                logger.LogWarning("AUTH_MODE=none: no login. Anyone who can reach this server has full access to its data.");
                return;
            }
            var password = await accounts.EnsureAdminAsync(settings.AdminPassword, cancellation);
            if (password is not null)
            {
                // Shown once, on purpose (spec: Accounts & Admin, Default admin). Straight to the
                // console: `docker logs` shows it, but log files and log servers never get the
                // password (the log pipeline would only mask it anyway).
                console.Write(
                    "\n============================================================\n" +
                    "  PeckList admin account created\n" +
                    $"    username: {AccountService.AdminUsername}\n" +
                    $"    password: {password}\n" +
                    "  Log in and change it. This is shown only once.\n" +
                    "============================================================\n");
                logger.LogWarning(
                    "Admin account {Username} created; its password was printed once to the console (docker logs). It must be changed at the first login.",
                    AccountService.AdminUsername);
            }
        }

        public Task StopAsync(CancellationToken cancellation) => Task.CompletedTask;
    }
}

/// <summary>
/// The process's own console, for the one thing that must reach the operator but never a log: the
/// generated first admin password.
/// </summary>
public sealed class StartupConsole(TextWriter writer)
{
    private readonly Lock gate = new();

    public void Write(string text)
    {
        lock (gate)
        {
            writer.Write(text);
            writer.Flush();
        }
    }
}

/// <summary>Endpoint metadata naming the permission it needs (lets tests check every admin endpoint has one).</summary>
public sealed record RequiresPermission(Permission Permission);
