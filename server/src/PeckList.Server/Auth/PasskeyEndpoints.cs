using System.Buffers.Text;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Fido2NetLib;
using Fido2NetLib.Objects;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Caching.Memory;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Audit;
using PeckList.Core.Configuration;
using PeckList.Server.Audit;

namespace PeckList.Server.Auth;

public sealed record PasskeyFinish(string? Ceremony, JsonElement Credential, string? Name = null, string? Token = null);
public sealed record PasskeyRename(string? Name);
public sealed record EnrollRequest(string? Token);
public sealed record PasswordRemoval(string? Current);

/// <summary>A passkey as its owner (or an admin) sees it: never its key.</summary>
public sealed record PasskeyView(string Id, string Name, DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt, bool Synced);

/// <summary>The account's passkeys, whether this server offers them here, and whether the account has a password.</summary>
public sealed record PasskeyList(bool Available, bool Password, IReadOnlyList<PasskeyView> Passkeys);

/// <summary>Where an enrolment from the app goes back to once the passkey is added.</summary>
public sealed record EnrollDone(string Back);

/// <summary>
/// Passkeys in PeckList itself (PL-123), with no identity provider in between: WebAuthn with
/// discoverable credentials, so signing in needs no username. The relying party is
/// <c>PUBLIC_URL</c>'s host (else the host the request came in on); passkeys need a secure address,
/// HTTPS or localhost, and <c>PASSKEYS=off</c> turns them off.
/// <para>
/// The Android app's WebView has no WebAuthn, so the app uses the hand-offs it already has: signing
/// in starts <c>/auth/app/handoff?provider=passkey</c>, which signs in on the web page in a browser
/// tab first; adding one starts the app link (<c>/auth/app/link-start</c> with <c>passkey</c>),
/// which opens an enrolment page in the tab that needs no session there.
/// </para>
/// </summary>
public static class PasskeyEndpoints
{
    /// <summary>The name passkeys go by where an identity provider's name would be (the app's hand-offs).</summary>
    public const string ProviderName = "passkey";
    public const string EnrollKind = "passkey-enroll";
    private const string EnrollPurpose = "pecklist.passkey-enroll.v1";
    private static readonly TimeSpan CeremonyLifetime = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan EnrollLifetime = TimeSpan.FromMinutes(10);
    private const int NameLength = 60;

    /// <summary>One sign-in or registration in progress: the options the browser was given.</summary>
    private sealed record Ceremony(string Kind, string Options, string? AccountId);

    private sealed record Enrolment(string AccountId, string Scheme, DateTimeOffset Expires);

    /// <summary>
    /// The origin passkeys belong to: <c>PUBLIC_URL</c>, else the address this request came in on;
    /// null when they are off or cannot work there (not HTTPS, and not localhost).
    /// </summary>
    public static Uri? Origin(LiveSettings live, HttpContext context)
    {
        if (!live.Current.Passkeys) return null;
        var address = live.Current.PublicUrl ?? new Uri($"{context.Request.Scheme}://{context.Request.Host}");
        var local = address.IsLoopback || address.Host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase);
        return address.Scheme == Uri.UriSchemeHttps || local ? new Uri(address.GetLeftPart(UriPartial.Authority)) : null;
    }

    private static Fido2 Fido(Uri origin) => new(new Fido2Configuration
    {
        RPID = origin.Host,
        RPName = "PeckList",
        Origins = new HashSet<string>(StringComparer.Ordinal) { origin.GetLeftPart(UriPartial.Authority) },
        TimestampDriftTolerance = 300_000,
    }, null!);

    private static string Encode(byte[] bytes) => Base64Url.EncodeToString(bytes);

    private static IResult Options(IMemoryCache cache, string kind, string json, string? accountId)
    {
        var id = Tokens.New(18);
        cache.Set($"passkey-ceremony:{id}", new Ceremony(kind, json, accountId), CeremonyLifetime);
        return Results.Text($"{{\"ceremony\":\"{id}\",\"options\":{json}}}", "application/json");
    }

    /// <summary>The ceremony a finish names, used up; null when unknown, spent, expired or of another kind.</summary>
    private static Ceremony? Take(IMemoryCache cache, string? id, string kind)
    {
        if (id is not { Length: > 0 and <= 64 }) return null;
        var key = $"passkey-ceremony:{id}";
        if (!cache.TryGetValue(key, out Ceremony? ceremony) || ceremony is null) return null;
        cache.Remove(key);
        return ceremony.Kind == kind ? ceremony : null;
    }

    private static string NameOf(string? typed)
    {
        var name = (typed ?? "").Trim();
        if (name.Length == 0) return "Passkey";
        return name.Length > NameLength ? name[..NameLength] : name;
    }

    private static PasskeyView View(Passkey passkey) => new(passkey.Id, passkey.Name, passkey.CreatedAt, passkey.LastUsedAt, passkey.BackedUp);

    private static IResult Off() => Results.NotFound(new AuthError("passkeys_off"));

    /// <summary>Creation options for a new passkey on the account (none of its own twice).</summary>
    private static async Task<IResult> CreationOptionsAsync(Account account, Uri origin, IPasskeyStore passkeys, IMemoryCache cache, CancellationToken cancellation)
    {
        var existing = await passkeys.ListAsync(account.Id, cancellation);
        var options = Fido(origin).RequestNewCredential(new RequestNewCredentialParams
        {
            User = new Fido2User { Id = Encoding.UTF8.GetBytes(account.Id), Name = account.Username, DisplayName = account.Username },
            ExcludeCredentials = [.. existing.Select(each => new PublicKeyCredentialDescriptor(Base64Url.DecodeFromChars(each.Id)))],
            AuthenticatorSelection = new AuthenticatorSelection
            {
                ResidentKey = ResidentKeyRequirement.Required,
                UserVerification = UserVerificationRequirement.Preferred,
            },
            AttestationPreference = AttestationConveyancePreference.None,
        });
        return Options(cache, "register", options.ToJson(), account.Id);
    }

    /// <summary>Check a new passkey against its ceremony and keep it; null when it does not verify.</summary>
    private static async Task<Passkey?> RegisterAsync(Ceremony ceremony, PasskeyFinish request, Uri origin, IPasskeyStore passkeys,
        TimeProvider time, CancellationToken cancellation)
    {
        try
        {
            var response = request.Credential.Deserialize<AuthenticatorAttestationRawResponse>()
                ?? throw new Fido2VerificationException("no credential");
            var made = await Fido(origin).MakeNewCredentialAsync(new MakeNewCredentialParams
            {
                AttestationResponse = response,
                OriginalOptions = CredentialCreateOptions.FromJson(ceremony.Options),
                IsCredentialIdUniqueToUserCallback = async (args, token) => await passkeys.FindAsync(Encode(args.CredentialId), token) is null,
            }, cancellation);
            var passkey = new Passkey
            {
                Id = Encode(made.Id),
                AccountId = ceremony.AccountId!,
                Name = NameOf(request.Name),
                PublicKey = Encode(made.PublicKey),
                SignCount = made.SignCount,
                Transports = made.Transports is { Length: > 0 } transports
                    ? string.Join(',', transports.Select(each => each.ToString().ToLowerInvariant()))
                    : null,
                BackedUp = made.IsBackedUp,
                CreatedAt = time.GetUtcNow(),
            };
            await passkeys.AddAsync(passkey, cancellation);
            return passkey;
        }
        catch (Exception error) when (error is Fido2VerificationException or JsonException or InvalidOperationException or FormatException)
        {
            return null;
        }
    }

    /// <summary><c>/auth/passkey/*</c>: signing in, and adding one from the app's browser tab. Reached signed out.</summary>
    public static void MapPasskeyAuth(this RouteGroupBuilder auth, string mode)
    {
        auth.MapPost("/passkey/sign-in/options", (LiveSettings live, IMemoryCache cache, HttpContext context) =>
        {
            if (Origin(live, context) is not { } origin) return Off();
            var options = Fido(origin).GetAssertionOptions(new GetAssertionOptionsParams
            {
                AllowedCredentials = [],
                UserVerification = UserVerificationRequirement.Preferred,
            });
            return Options(cache, "sign-in", options.ToJson(), null);
        }).RequireRateLimiting(AuthSetup.LoginRateLimit);

        auth.MapPost("/passkey/sign-in", async (PasskeyFinish request, LiveSettings live, IMemoryCache cache, IPasskeyStore passkeys,
            IAccountStore accounts, TimeProvider time, HttpContext context, CancellationToken cancellation) =>
        {
            context.Audit().Anonymous = true;
            context.Audit().Detail = "passkey";
            if (Origin(live, context) is not { } origin) return Off();
            var invalid = Results.Json(new AuthError("invalid"), statusCode: StatusCodes.Status401Unauthorized);
            if (Take(cache, request.Ceremony, "sign-in") is not { } ceremony) return invalid;
            AuthenticatorAssertionRawResponse? response;
            try
            {
                response = request.Credential.Deserialize<AuthenticatorAssertionRawResponse>();
            }
            catch (JsonException)
            {
                return invalid;
            }
            if (response?.RawId is not { Length: > 0 } rawId || await passkeys.FindAsync(Encode(rawId), cancellation) is not { } passkey) return invalid;
            if (await accounts.FindByIdAsync(passkey.AccountId, cancellation) is not { Disabled: false, DeletedAt: null } account) return invalid;
            try
            {
                var verified = await Fido(origin).MakeAssertionAsync(new MakeAssertionParams
                {
                    AssertionResponse = response,
                    OriginalOptions = AssertionOptions.FromJson(ceremony.Options),
                    StoredPublicKey = Base64Url.DecodeFromChars(passkey.PublicKey),
                    StoredSignatureCounter = (uint)passkey.SignCount,
                    // The passkey must be the one this account's user handle names.
                    IsUserHandleOwnerOfCredentialIdCallback = (args, _) =>
                        Task.FromResult(Encoding.UTF8.GetString(args.UserHandle) == passkey.AccountId),
                }, cancellation);
                await passkeys.UpdateAsync(passkey with { SignCount = verified.SignCount, BackedUp = verified.IsBackedUp, LastUsedAt = time.GetUtcNow() }, cancellation);
            }
            catch (Exception error) when (error is Fido2VerificationException or FormatException)
            {
                return invalid;
            }
            context.Audit().Actor(account).Anonymous = false;
            var principal = AuthSetup.Principal(account with { MustChangePassword = false }, CookieAuthenticationDefaults.AuthenticationScheme, AuthSetup.ByPasskey);
            await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, new AuthenticationProperties { IsPersistent = true });
            return Results.Ok(AuthEndpoints.MeOf(principal, mode));
        }).RequireRateLimiting(AuthSetup.LoginRateLimit).Audited("auth.sign-in", targetRoute: null);

        // Adding a passkey from the Android app: the page in its browser tab holds a token for the
        // account (from /auth/app/link), not a session.
        auth.MapPost("/passkey/enroll/options", async (EnrollRequest request, LiveSettings live, IMemoryCache cache, IPasskeyStore passkeys,
            IAccountStore accounts, ISecretStore secrets, IDataProtectionProvider protection, TimeProvider time, HttpContext context,
            CancellationToken cancellation) =>
        {
            if (Origin(live, context) is not { } origin) return Off();
            if (await EnrolmentAsync(request.Token, secrets, protection, time, spend: false, cancellation) is not { } enrolment
                || await accounts.FindByIdAsync(enrolment.AccountId, cancellation) is not { Disabled: false, DeletedAt: null } account)
            {
                return Results.NotFound(new AuthError("link_expired"));
            }
            return await CreationOptionsAsync(account, origin, passkeys, cache, cancellation);
        }).RequireRateLimiting(AuthSetup.LoginRateLimit);

        auth.MapPost("/passkey/enroll", async (PasskeyFinish request, LiveSettings live, IMemoryCache cache, IPasskeyStore passkeys,
            IAccountStore accounts, ISecretStore secrets, IDataProtectionProvider protection, TimeProvider time, HttpContext context,
            CancellationToken cancellation) =>
        {
            if (Origin(live, context) is not { } origin) return Off();
            var ceremony = Take(cache, request.Ceremony, "register");
            if (await EnrolmentAsync(request.Token, secrets, protection, time, spend: true, cancellation) is not { } enrolment
                || ceremony?.AccountId != enrolment.AccountId
                || await accounts.FindByIdAsync(enrolment.AccountId, cancellation) is not { } account)
            {
                return Results.NotFound(new AuthError("link_expired"));
            }
            if (await RegisterAsync(ceremony, request, origin, passkeys, time, cancellation) is not { } passkey)
            {
                return Results.BadRequest(new AuthError("invalid"));
            }
            context.Audit().Actor(account).On(passkey.Id, passkey.Name);
            return Results.Ok(new EnrollDone($"{enrolment.Scheme}://link?result=passkey_added"));
        }).RequireRateLimiting(AuthSetup.LoginRateLimit).Audited("account.passkey-added", targetRoute: null);
    }

    /// <summary>A token the app's link step made for adding a passkey (see <see cref="EnrolLink"/>).</summary>
    private static async Task<Enrolment?> EnrolmentAsync(string? token, ISecretStore secrets, IDataProtectionProvider protection,
        TimeProvider time, bool spend, CancellationToken cancellation)
    {
        if (token is not { Length: > 0 and <= 100 }) return null;
        var key = Tokens.Hash(token);
        var stored = (await secrets.ListAsync(EnrollKind, cancellation)).FirstOrDefault(each => each.Name == key).Value;
        if (string.IsNullOrEmpty(stored)) return null;
        if (spend) await secrets.PutAsync(EnrollKind, key, "", cancellation);
        try
        {
            var enrolment = JsonSerializer.Deserialize<Enrolment>(protection.CreateProtector(EnrollPurpose).Unprotect(stored));
            return enrolment is not null && enrolment.Expires > time.GetUtcNow() ? enrolment : null;
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            return null;
        }
    }

    /// <summary>
    /// The page that adds a passkey in the app's browser tab, for an account the app is signed in to:
    /// <c>/passkey/add?token=...</c>, working once, for ten minutes.
    /// </summary>
    public static async Task<string> EnrolLink(string accountId, string scheme, ISecretStore secrets, IDataProtectionProvider protection,
        TimeProvider time, CancellationToken cancellation)
    {
        var token = Tokens.New();
        var enrolment = new Enrolment(accountId, scheme, time.GetUtcNow() + EnrollLifetime);
        await secrets.PutAsync(EnrollKind, Tokens.Hash(token),
            protection.CreateProtector(EnrollPurpose).Protect(JsonSerializer.Serialize(enrolment)), cancellation);
        return $"/passkey/add?token={token}";
    }

    /// <summary><c>/api/account/passkeys</c> and removing the password: the signed-in person's own.</summary>
    public static RouteGroupBuilder MapAccountPasskeys(this RouteGroupBuilder api)
    {
        api.MapGet("/account/passkeys", async (ClaimsPrincipal user, IAccountStore accounts, IPasskeyStore passkeys, LiveSettings live,
            HttpContext context, CancellationToken cancellation) =>
        {
            if (await accounts.FindByIdAsync(user.UserId(), cancellation) is not { } account) return Results.NotFound();
            var mine = await passkeys.ListAsync(account.Id, cancellation);
            return Results.Ok(new PasskeyList(Origin(live, context) is not null, account.PasswordHash is not null, [.. mine.Select(View)]));
        });

        api.MapPost("/account/passkeys/options", async (ClaimsPrincipal user, IAccountStore accounts, IPasskeyStore passkeys, LiveSettings live,
            IMemoryCache cache, HttpContext context, CancellationToken cancellation) =>
        {
            if (user.Impersonator() is not null) return Results.Json(new AuthError("not_while_impersonating"), statusCode: StatusCodes.Status403Forbidden);
            if (Origin(live, context) is not { } origin) return Off();
            if (await accounts.FindByIdAsync(user.UserId(), cancellation) is not { } account) return Results.NotFound();
            return await CreationOptionsAsync(account, origin, passkeys, cache, cancellation);
        });

        api.MapPost("/account/passkeys", async (PasskeyFinish request, ClaimsPrincipal user, LiveSettings live, IMemoryCache cache,
            IPasskeyStore passkeys, TimeProvider time, HttpContext context, CancellationToken cancellation) =>
        {
            if (user.Impersonator() is not null) return Results.Json(new AuthError("not_while_impersonating"), statusCode: StatusCodes.Status403Forbidden);
            if (Origin(live, context) is not { } origin) return Off();
            if (Take(cache, request.Ceremony, "register") is not { } ceremony || ceremony.AccountId != user.UserId())
            {
                return Results.BadRequest(new AuthError("expired"));
            }
            if (await RegisterAsync(ceremony, request, origin, passkeys, time, cancellation) is not { } passkey)
            {
                return Results.BadRequest(new AuthError("invalid"));
            }
            context.Audit().On(passkey.Id, passkey.Name);
            return Results.Ok(View(passkey));
        }).Audited("account.passkey-added", targetRoute: null);

        api.MapPut("/account/passkeys/{id}", async (string id, PasskeyRename request, ClaimsPrincipal user, IPasskeyStore passkeys,
            CancellationToken cancellation) =>
        {
            if (user.Impersonator() is not null) return Results.Json(new AuthError("not_while_impersonating"), statusCode: StatusCodes.Status403Forbidden);
            if (await passkeys.FindAsync(id, cancellation) is not { } passkey || passkey.AccountId != user.UserId()) return Results.NotFound();
            var renamed = passkey with { Name = NameOf(request.Name) };
            await passkeys.UpdateAsync(renamed, cancellation);
            return Results.Ok(View(renamed));
        });

        api.MapDelete("/account/passkeys/{id}", async (string id, ClaimsPrincipal user, IPasskeyStore passkeys, IAccountStore accounts,
            ExternalSignIn signIn, HttpContext context, CancellationToken cancellation) =>
        {
            if (user.Impersonator() is not null) return Results.Json(new AuthError("not_while_impersonating"), statusCode: StatusCodes.Status403Forbidden);
            if (await passkeys.FindAsync(id, cancellation) is not { } passkey || passkey.AccountId != user.UserId()) return Results.NotFound();
            context.Audit().On(passkey.Id, passkey.Name);
            var account = (await accounts.FindByIdAsync(passkey.AccountId, cancellation))!;
            var otherWayIn = account.PasswordHash is not null
                || (await passkeys.ListAsync(account.Id, cancellation)).Count > 1
                || (await signIn.IdentitiesOfAsync(account.Id, cancellation)).Count > 0;
            if (!otherWayIn) return Results.Conflict(new AdminError("last_way_in", "this is your only way to sign in"));
            await passkeys.DeleteAsync(id, cancellation);
            return Results.NoContent();
        }).Audited("account.passkey-removed", targetRoute: null);

        // With a passkey (or a provider), a person may do without a password.
        api.MapPost("/account/password/remove", async (PasswordRemoval request, ClaimsPrincipal user, AccountService accounts,
            IAccountStore store, ExternalSignIn signIn, IMemoryCache cache, HttpContext context, CancellationToken cancellation) =>
        {
            if (user.Impersonator() is not null) return Results.Json(new AuthError("not_while_impersonating"), statusCode: StatusCodes.Status403Forbidden);
            if (await store.FindByIdAsync(user.UserId(), cancellation) is not { PasswordHash: not null } account) return Results.Conflict(new AuthError("no_password"));
            if (!await signIn.CanSignInAsync(account with { PasswordHash = null }, cancellation))
            {
                return Results.Conflict(new AdminError("last_way_in", "add a passkey first"));
            }
            var (result, updated) = await accounts.RemovePasswordAsync(account.Id, request.Current ?? "", cancellation);
            if (result != PasswordChange.Changed) return Results.BadRequest(new AuthError(result == PasswordChange.DemoAccount ? "demo_account" : "wrong_password"));
            // Password sessions elsewhere end (new stamp); this one carries on with a fresh cookie.
            AuthSetup.ForgetStamp(cache, updated!.Id);
            var method = user.FindFirstValue(AuthSetup.MethodClaim) ?? AuthSetup.ByPassword;
            var principal = AuthSetup.Principal(updated, CookieAuthenticationDefaults.AuthenticationScheme, method);
            await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, new AuthenticationProperties { IsPersistent = true });
            return Results.NoContent();
        }).RequireRateLimiting(AuthSetup.LoginRateLimit).Audited("account.password-removed", targetRoute: null);

        return api;
    }

    /// <summary><c>/api/admin/users/{id}/passkeys</c>: see and remove a person's passkeys (a lost phone).</summary>
    public static RouteGroupBuilder MapAdminPasskeys(this RouteGroupBuilder admin)
    {
        admin.MapGet("/users/{id}/passkeys", async (string id, IPasskeyStore passkeys, CancellationToken cancellation) =>
            Results.Ok((await passkeys.ListAsync(id, cancellation)).Select(View))).RequirePermission(Permission.ManageUsers);

        admin.MapDelete("/users/{id}/passkeys/{passkeyId}", async (string id, string passkeyId, ClaimsPrincipal user, IAccountStore store,
            IPasskeyStore passkeys, HttpContext context, CancellationToken cancellation) =>
            await AdminEndpoints.OnAccountAsync(id, user, store, async _ =>
            {
                if (await passkeys.FindAsync(passkeyId, cancellation) is not { } passkey || passkey.AccountId != id) return Results.NotFound();
                await passkeys.DeleteAsync(passkeyId, cancellation);
                context.Audit().Detail = passkey.Name;
                return Results.NoContent();
            }, cancellation)).RequirePermission(Permission.ManageUsers).Audited("admin.passkey-removed");
        return admin;
    }
}
