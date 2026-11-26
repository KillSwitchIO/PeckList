using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Calendars;
using PeckList.Core.Configuration;
using PeckList.Google;
using PeckList.Server.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server.Calendars;

/// <summary>The server's Google clients: an admin's own (read live), else the built-in PeckList client.</summary>
public sealed class ServerGoogleClients(LiveSettings live, GoogleClient? builtIn) : IGoogleClients
{
    /// <summary>The admin's own client, when both its id and secret are set.</summary>
    public GoogleClient? Own =>
        live.Current is { CalendarGoogleClientId: { Length: > 0 } id, CalendarGoogleClientSecret: { Length: > 0 } secret }
            ? new GoogleClient(id.Trim(), secret.Trim(), Relay: false)
            : null;

    /// <inheritdoc />
    public GoogleClient? Current => Own ?? builtIn;

    /// <inheritdoc />
    public GoogleClient? ById(string id) => Own is { } own && own.Id == id ? own : builtIn is { } shared && shared.Id == id ? shared : null;
}

/// <summary>
/// Connecting a Google account (spec: PL-134, Google Sign-In for Everyone; the design note's sign-in
/// flow). Both ways in, the web's <c>/auth/oidc/calendar-google/link</c> and the Android app's
/// provider-link hand-off, end in <see cref="BeginAsync"/>: a PKCE sign-in at Google whose state names
/// this server's callback, signed so the relay page can read it and nobody can forge it, and a
/// cookie that ties the sign-in to the browser that began it. The callback swaps the code for tokens
/// here, so nothing passes through pecklist.com after the code.
/// </summary>
/// <remarks>
/// When the browser that finishes is not signed in as the person who began (always so in the app's
/// browser tab), a confirm page names the Google address and the PeckList account first: the relay
/// page names only the server, so without it a sign-in link someone else began on the same server
/// could be finished by the victim and attach their calendars to the other account.
/// </remarks>
public sealed class GoogleConnect(
    ISecretStore secrets,
    IDataProtectionProvider protection,
    IGoogleClients clients,
    GoogleCalendarProvider google,
    ServerSettings settings,
    LiveSettings live,
    ICalendarStore store,
    ICalendarSecrets calendarSecrets,
    IAccountStore accounts,
    AuditLog audit,
    TimeProvider time,
    ILogger<GoogleConnect> logger)
{
    /// <summary>
    /// The name Google calendar connect goes by in the provider-link routes, beside <c>passkey</c>. An
    /// OIDC provider of this name keeps working and wins; calendar Google is then off on that server.
    /// </summary>
    public const string LinkName = "calendar-google";

    /// <summary>The callback's path; with an admin's own client, the redirect they register.</summary>
    public const string CallbackPath = "/auth/calendar/google/callback";

    public const string ConfirmPath = "/auth/calendar/google/confirm";

    /// <summary>The cookie that ties a sign-in to the browser that began it.</summary>
    public const string Cookie = "pecklist_calendar_oauth";

    /// <summary>One-time secret kinds: sign-ins under way, and sign-ins waiting for the confirm page.</summary>
    public const string PendingKind = "calendar-google-pending";

    public const string ConfirmKind = "calendar-google-confirm";

    /// <summary>How long a sign-in may take at Google.</summary>
    public static readonly TimeSpan PendingLifetime = TimeSpan.FromMinutes(15);

    /// <summary>How long the confirm page waits.</summary>
    public static readonly TimeSpan ConfirmLifetime = TimeSpan.FromMinutes(10);

    private const string Purpose = "PeckList.Calendars.GoogleConnect";
    private const string StateKeyName = "google-state-key";

    // Starting a sign-in stores a one-time row: the same few tries per person as connecting CalDAV.
    private readonly PartitionedRateLimiter<string> begins = PartitionedRateLimiter.Create<string, string>(user =>
        RateLimitPartition.GetFixedWindowLimiter(user, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = CalendarEndpoints.ConnectsPerWindow,
            Window = CalendarEndpoints.ConnectWindow,
        }));
    private readonly SemaphoreSlim keyGate = new(1, 1);
    private byte[]? stateKey;

    /// <summary>The outcomes the browser lands on (<c>?calendar=</c> on the web, <c>result=</c> in the app). Short: the app takes <c>[a-z_]{1,20}</c>.</summary>
    public static class Outcomes
    {
        public const string Connected = "cal_connected";
        public const string Cancelled = "cal_cancelled";
        public const string ScopeMissing = "cal_scope_missing";
        public const string Expired = "cal_expired";
        public const string AuthFailed = "cal_auth_failed";
        public const string Unreachable = "cal_unreachable";
        public const string Unavailable = "cal_unavailable";
        public const string Failed = "cal_failed";
    }

    /// <summary>Whether people can connect Google here: sync on, a client to sign in with, and no OIDC provider holding the name.</summary>
    public bool Available => live.Current.CalendarSync && clients.Current is not null && !NameTaken;

    /// <summary>An OIDC provider is configured as <see cref="LinkName"/>: it keeps the name, and calendar Google is off.</summary>
    public bool NameTaken => settings.Provider(LinkName) is not null;

    /// <summary>Logs, once at startup, why Google is off when an OIDC provider holds its name, so the admin can rename one.</summary>
    public void WarnIfNameTaken()
    {
        if (NameTaken)
        {
            logger.LogWarning("An OIDC provider is named {Name}, which Google calendar sign-in also uses: the provider keeps working and Google Calendar can't be connected on this server. Rename the provider to offer Google Calendar.", LinkName);
        }
    }

    /// <summary>
    /// The callback address a new sign-in names. With an admin's own client: PUBLIC_URL, else the
    /// request's own (Google refuses a redirect the admin did not register). With the built-in
    /// client, whose relay page sends the browser wherever the state says: only an address links may
    /// use (<see cref="ServerApp.LinkOrigin"/>, audit S16), so null without PUBLIC_URL on a public name.
    /// </summary>
    public static string? CallbackUrl(HttpContext context, GoogleClient client) =>
        (client.Relay ? ServerApp.LinkOrigin(context) : ServerApp.Origin(context)) is { } origin ? origin + CallbackPath : null;

    /// <summary>
    /// Step 1, in the browser: a new sign-in for <paramref name="userId"/>, going back to the app
    /// through <paramref name="scheme"/> when it began there. Redirects to Google, or lands on
    /// <see cref="Outcomes.Unavailable"/>.
    /// </summary>
    public async Task<IResult> BeginAsync(HttpContext context, string userId, string? scheme)
    {
        if (!Available || clients.Current is not { } client) return Land(scheme, Outcomes.Unavailable);
        using var lease = begins.AttemptAcquire(userId);
        if (!lease.IsAcquired)
        {
            logger.LogInformation("Google calendar sign-ins for {User} are over the connect limit", userId);
            return Land(scheme, Outcomes.Failed);
        }
        var verifier = Tokens.New();
        var nonce = Tokens.New();
        if (CallbackUrl(context, client) is not { } callback)
        {
            logger.LogWarning("Google calendar sign-in through the PeckList client needs PUBLIC_URL on a server reached by a public name");
            return Land(scheme, Outcomes.Unavailable);
        }
        var redirect = client.Relay ? GoogleDefaults.RelayUrl.ToString() : callback;
        var pending = new Pending(userId, verifier, client.Id, redirect, callback, scheme, time.GetUtcNow() + PendingLifetime);
        await secrets.PutAsync(PendingKind, Tokens.Hash(nonce), Protect(pending), context.RequestAborted);
        context.Response.Cookies.Append(Cookie, nonce, new CookieOptions
        {
            HttpOnly = true,
            Secure = context.Request.IsHttps,
            // Lax: sent on the top-level redirect back from Google or the relay page, not on a page's requests.
            SameSite = SameSiteMode.Lax,
            Path = "/auth/calendar/google",
            MaxAge = PendingLifetime,
            IsEssential = true,
        });
        var state = await StateAsync(callback, nonce, context.RequestAborted);
        return Results.Redirect(google.OAuth.AuthorizeUrl(client, redirect, state, AppSignIn.ChallengeOf(verifier)).AbsoluteUri);
    }

    /// <summary>Step 2: back from Google (or the relay page) with a code, or an error.</summary>
    public async Task<IResult> CallbackAsync(HttpContext context, string? code, string? state, string? error)
    {
        NoStore(context);
        var cancellation = context.RequestAborted;
        var read = await ReadStateAsync(state, cancellation);
        var nonce = context.Request.Cookies[Cookie];
        // The state must be ours and name this server; the cookie must be the one this browser got at the start.
        // A call that fails here leaves the sign-in and the cookie alone: it was not this browser's.
        if (read is not { } parts || parts.Callback != ServerApp.Origin(context) + CallbackPath || nonce is null
            || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(nonce), Encoding.UTF8.GetBytes(parts.Nonce)))
        {
            return Land(null, Outcomes.Expired);
        }
        context.Response.Cookies.Delete(Cookie, new CookieOptions { Path = "/auth/calendar/google", Secure = context.Request.IsHttps, SameSite = SameSiteMode.Lax, HttpOnly = true });
        var pending = await TakeAsync<Pending>(PendingKind, parts.Nonce, cancellation);
        if (pending is null || pending.Expires <= time.GetUtcNow()) return Land(null, Outcomes.Expired);
        if (error is not null) return Land(pending.Scheme, error == "access_denied" ? Outcomes.Cancelled : Outcomes.Failed);
        if (string.IsNullOrEmpty(code) || code.Length > 2048) return Land(pending.Scheme, Outcomes.Failed);
        if (clients.ById(pending.ClientId) is not { } client) return Land(pending.Scheme, Outcomes.Unavailable);

        GoogleToken token;
        string address;
        IReadOnlyList<RemoteCalendar> calendars;
        try
        {
            token = await google.OAuth.ExchangeAsync(client, code, pending.RedirectUri, pending.Verifier, cancellation);
            if (!GoogleScopes.Granted(token.Scope))
            {
                await RevokeQuietlyAsync(token, cancellation);
                return Land(pending.Scheme, Outcomes.ScopeMissing);
            }
            var connection = new CalendarConnection(GoogleCalendarProvider.ServerUrl, null, token.Write());
            address = await google.AddressAsync(connection, cancellation);
            calendars = await google.CalendarsAsync(connection, cancellation);
        }
        catch (CalendarProblem problem)
        {
            logger.LogInformation("Google calendar sign-in did not finish: {Code}", problem.Code);
            return Land(pending.Scheme, OutcomeOf(problem));
        }

        var session = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        if (session.Principal?.Identity?.IsAuthenticated == true && session.Principal.UserId() == pending.UserId)
        {
            await SaveAsync(context, pending.UserId, address, token, calendars, cancellation);
            return Land(pending.Scheme, Outcomes.Connected);
        }
        // Not signed in here as the person who began: they confirm, seeing whose calendars go where.
        if (await accounts.FindByIdAsync(pending.UserId, cancellation) is not { } account) return Land(pending.Scheme, Outcomes.Failed);
        var confirmCode = Tokens.New();
        var waiting = new Waiting(pending.UserId, await calendarSecrets.ProtectAsync(token.Write(), cancellation), address, pending.Scheme, time.GetUtcNow() + ConfirmLifetime);
        await secrets.PutAsync(ConfirmKind, Tokens.Hash(confirmCode), Protect(waiting), cancellation);
        ConfirmHeaders(context);
        var text = $"Connect the calendars of <strong>{WebUtility.HtmlEncode(address)}</strong> to the PeckList account "
            + $"<strong>{WebUtility.HtmlEncode(account.Username)}</strong>? If you did not just ask for this, close this tab.";
        // Signed in here as someone else: say so, so a link someone else began stands out.
        if (session.Principal?.Identity?.IsAuthenticated == true && session.Principal.FindFirstValue(ClaimTypes.Name) is { Length: > 0 } here)
        {
            text += $"<br><br>You're signed in here as <strong>{WebUtility.HtmlEncode(here)}</strong>.";
        }
        return Results.Content(AppSignIn.ConfirmationPage("Connect Google Calendar?", text, ConfirmPath, ("code", confirmCode)), "text/html; charset=utf-8");
    }

    /// <summary>Step 3, only when the callback asked: the person pressed Continue on the confirm page.</summary>
    public async Task<IResult> ConfirmAsync(HttpContext context, string? code)
    {
        NoStore(context);
        var cancellation = context.RequestAborted;
        var waiting = await TakeAsync<Waiting>(ConfirmKind, code ?? "", cancellation);
        if (waiting is null || waiting.Expires <= time.GetUtcNow()) return Land(null, Outcomes.Expired);
        var token = GoogleToken.Read(await calendarSecrets.UnprotectAsync(waiting.Secret, cancellation));
        if (token is null) return Land(waiting.Scheme, Outcomes.Failed);
        IReadOnlyList<RemoteCalendar> calendars;
        try
        {
            calendars = await google.CalendarsAsync(new CalendarConnection(GoogleCalendarProvider.ServerUrl, null, token.Write()), cancellation);
        }
        catch (CalendarProblem problem)
        {
            return Land(waiting.Scheme, OutcomeOf(problem));
        }
        await SaveAsync(context, waiting.UserId, waiting.Address, token, calendars, cancellation);
        return Land(waiting.Scheme, Outcomes.Connected);
    }

    /// <summary>
    /// The account saved: a Google address this person has connected already gets the new token and
    /// is working again, its calendars and modes kept; a new one comes with its calendars Off.
    /// </summary>
    private async Task SaveAsync(HttpContext context, string userId, string address, GoogleToken token, IReadOnlyList<RemoteCalendar> calendars, CancellationToken cancellation)
    {
        var secret = await calendarSecrets.ProtectAsync(token.Write(), cancellation);
        var existing = (await store.AccountsAsync(userId, cancellation)).FirstOrDefault(each => each.Provider == google.Kind && each.Name == address);
        CalendarAccount account;
        if (existing is not null)
        {
            account = existing with { Secret = secret, Status = CalendarAccount.Ok, Problem = null };
            await store.SaveAccountAsync(account, cancellation);
        }
        else
        {
            account = new CalendarAccount(Ids.NewUlid(time), userId, google.Kind, address, GoogleCalendarProvider.ServerUrl, null, secret, CalendarAccount.Ok, null, time.GetUtcNow());
            await store.SaveAccountAsync(account, cancellation);
        }
        var linked = (await store.LinksAsync(userId, cancellation)).Where(each => each.CalendarAccountId == account.Id).Select(each => each.RemoteId).ToHashSet(StringComparer.Ordinal);
        foreach (var remote in calendars.Where(each => !linked.Contains(each.Id)))
        {
            await store.SaveLinkAsync(CalendarEndpoints.NewLink(Ids.NewUlid(time), account, remote, CalendarModes.Off, null, null, false), cancellation);
        }
        var who = await accounts.FindByIdAsync(userId, cancellation);
        audit.RecordEvent(context, CalendarEndpoints.ConnectedAudit, userId, who?.Username, account.Id, null, google.Kind);
    }

    /// <summary>Ends a grant nobody will use (scopes missing), best effort.</summary>
    private async Task RevokeQuietlyAsync(GoogleToken token, CancellationToken cancellation)
    {
        try
        {
            await google.OAuth.RevokeAsync(token, cancellation);
        }
        catch (CalendarProblem)
        {
            // Google lets an unused grant lapse on its own; the person sees why it failed either way.
        }
    }

    private static string OutcomeOf(CalendarProblem problem) => problem.Kind switch
    {
        CalendarProblemKind.Auth => Outcomes.AuthFailed,
        CalendarProblemKind.Unavailable or CalendarProblemKind.RateLimited => Outcomes.Unreachable,
        _ => Outcomes.Failed,
    };

    /// <summary>Where the browser lands: the web's Calendars settings, or back to the app through the provider-link return it already handles.</summary>
    public static IResult Land(string? scheme, string outcome) =>
        Results.Redirect(scheme is null ? $"/settings/calendars?calendar={outcome}" : $"{scheme}://link?result={outcome}");

    /// <summary>
    /// The state Google and the relay page carry: <c>base64url(JSON {v, r, n}) + "." + base64url(HMAC)</c>.
    /// The relay page reads <c>r</c> (where to send the code); only this server can make or check the MAC.
    /// </summary>
    public async Task<string> StateAsync(string callback, string nonce, CancellationToken cancellation)
    {
        var payload = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new StatePayload(1, callback, nonce)));
        return payload + "." + Base64Url(HMACSHA256.HashData(await StateKeyAsync(cancellation), Encoding.ASCII.GetBytes(payload)));
    }

    /// <summary>The callback and nonce of a state this server made, or null.</summary>
    public async Task<(string Callback, string Nonce)?> ReadStateAsync(string? state, CancellationToken cancellation)
    {
        if (state is null || state.Length > 4096) return null;
        var dot = state.IndexOf('.', StringComparison.Ordinal);
        if (dot <= 0) return null;
        var payload = state[..dot];
        byte[] mac;
        try
        {
            mac = FromBase64Url(state[(dot + 1)..]);
        }
        catch (FormatException)
        {
            return null;
        }
        var expected = HMACSHA256.HashData(await StateKeyAsync(cancellation), Encoding.ASCII.GetBytes(payload));
        if (!CryptographicOperations.FixedTimeEquals(mac, expected)) return null;
        try
        {
            var read = JsonSerializer.Deserialize<StatePayload>(FromBase64Url(payload));
            return read is { V: 1, R: { } callback, N: { } nonce } ? (callback, nonce) : null;
        }
        catch (Exception problem) when (problem is JsonException or FormatException)
        {
            return null;
        }
    }

    /// <summary>When a stored pending or waiting sign-in runs out, for the daily prune; null when it can't be read.</summary>
    public static DateTimeOffset? ExpiresOf(IDataProtectionProvider protection, string stored) =>
        AppSignIn.ProtectedExpiry(protection.CreateProtector(Purpose), stored);

    private async Task<byte[]> StateKeyAsync(CancellationToken cancellation)
    {
        if (stateKey is not null) return stateKey;
        await keyGate.WaitAsync(cancellation);
        try
        {
            if (stateKey is not null) return stateKey;
            var stored = await secrets.GetAsync(CalendarInstance.Kind, StateKeyName, cancellation);
            if (stored is null)
            {
                stored = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
                await secrets.PutAsync(CalendarInstance.Kind, StateKeyName, stored, cancellation);
            }
            return stateKey = Convert.FromBase64String(stored);
        }
        finally
        {
            keyGate.Release();
        }
    }

    private string Protect<T>(T value) => protection.CreateProtector(Purpose).Protect(JsonSerializer.Serialize(value));

    private async Task<T?> TakeAsync<T>(string kind, string code, CancellationToken cancellation) where T : class
    {
        if (code.Length is 0 or > 100) return null;
        var stored = await secrets.TakeAsync(kind, Tokens.Hash(code), cancellation);
        if (string.IsNullOrEmpty(stored)) return null;
        try
        {
            return JsonSerializer.Deserialize<T>(protection.CreateProtector(Purpose).Unprotect(stored));
        }
        catch (Exception problem) when (problem is CryptographicException or JsonException)
        {
            return null;
        }
    }

    private static void NoStore(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        // The code is in this address: it must not follow the person to the next page.
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
    }

    /// <summary>The confirm page: not framed, no script, and its form posts only here.</summary>
    private static void ConfirmHeaders(HttpContext context)
    {
        var headers = context.Response.Headers;
        headers.ContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
        headers.XFrameOptions = "DENY";
        // Not no-referrer: Chrome would send "Origin: null" with the form, which the same-origin guard refuses.
        headers["Referrer-Policy"] = "same-origin";
    }

    private static string Base64Url(byte[] bytes) => System.Buffers.Text.Base64Url.EncodeToString(bytes);

    private static byte[] FromBase64Url(string text) => System.Buffers.Text.Base64Url.DecodeFromChars(text);

    private sealed record StatePayload(
        [property: JsonPropertyName("v")] int V,
        [property: JsonPropertyName("r")] string? R,
        [property: JsonPropertyName("n")] string? N);

    /// <summary>A sign-in under way. <see cref="Expires"/> is read by the prune.</summary>
    private sealed record Pending(string UserId, string Verifier, string ClientId, string RedirectUri, string Callback, string? Scheme, DateTimeOffset Expires);

    /// <summary>A sign-in waiting for the confirm page; the token encrypted as calendar secrets are.</summary>
    private sealed record Waiting(string UserId, string Secret, string Address, string? Scheme, DateTimeOffset Expires);
}

/// <summary>The Google routes outside <c>/api</c>'s sign-in requirement: the sign-in's callback and confirm, and the push webhook.</summary>
public static class GoogleConnectEndpoints
{
    /// <summary>The rate limit on push calls, per address: Google calls once per change, so a flood is someone else.</summary>
    public const string PushRateLimit = "calendar-google-push";

    public const int PushesPerMinute = 120;

    public static IEndpointRouteBuilder MapGoogleCalendar(this IEndpointRouteBuilder app)
    {
        // A sign-in's callback and confirm are anonymous by nature (the app's browser tab has no
        // session); what they act on is fixed by the signed state, the browser's cookie and the
        // one-time codes.
        app.MapGet(GoogleConnect.CallbackPath, (string? code, string? state, string? error, GoogleConnect connect, LiveSettings live, HttpContext context) =>
            live.Current.CalendarSync ? connect.CallbackAsync(context, code, state, error) : Task.FromResult(Results.NotFound()))
            .AllowAnonymous().RequireRateLimiting(CalendarEndpoints.ConnectRateLimit).ExcludeFromDescription();

        app.MapPost(GoogleConnect.ConfirmPath, async (HttpContext context, GoogleConnect connect, LiveSettings live) =>
        {
            if (!live.Current.CalendarSync) return Results.NotFound();
            var form = await context.Request.ReadFormAsync(context.RequestAborted);
            return await connect.ConfirmAsync(context, form["code"].ToString());
        }).AllowAnonymous().DisableAntiforgery().RequireRateLimiting(CalendarEndpoints.ConnectRateLimit).ExcludeFromDescription();

        // Google's push (events.watch). Always 200 with nothing in it, whatever was wrong, so a
        // caller learns nothing and Google does not retry; only a call that matches a channel
        // exactly nudges its calendar's run.
        app.MapPost("/api/calendars/google/push", async (HttpContext context, LiveSettings live, ICalendarStore store, CalendarNudges nudges) =>
        {
            if (!live.Current.CalendarSync) return Results.NotFound();
            var headers = context.Request.Headers;
            var channelId = headers["X-Goog-Channel-ID"].ToString();
            var token = headers["X-Goog-Channel-Token"].ToString();
            var resource = headers["X-Goog-Resource-ID"].ToString();
            var state = headers["X-Goog-Resource-State"].ToString();
            if (channelId.Length is 0 or > 200 || token.Length is 0 or > 256 || state != "exists") return Results.Ok();
            if (await store.LinkByChannelAsync(channelId, context.RequestAborted) is not { Channel: { } channel, ChannelTokenHash: { } hash } link) return Results.Ok();
            // Security N1: the token is compared by its hash, in constant time.
            var matches = CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Tokens.Hash(token)), Encoding.ASCII.GetBytes(hash))
                && string.Equals(channel.ResourceId, resource, StringComparison.Ordinal);
            if (matches && link.Mode != CalendarModes.Off) nudges.NudgeLink(link.Id);
            return Results.Ok();
        }).AllowAnonymous().RequireRateLimiting(PushRateLimit).ExcludeFromDescription();

        return app;
    }
}
