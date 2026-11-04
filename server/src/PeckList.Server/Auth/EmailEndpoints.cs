using System.Security.Claims;
using Microsoft.Extensions.Caching.Memory;
using PeckList.Core.Accounts;
using PeckList.Core.Audit;
using PeckList.Core.Configuration;
using PeckList.Core.Mail;
using PeckList.Server.Audit;

namespace PeckList.Server.Auth;

public sealed record ForgotRequest(string? Login);
public sealed record ResetRequest(string? Token, string? Password);
public sealed record ResetLinkInfo(string Username);
public sealed record EmailRequest(string? Email);

/// <summary>The signed-in person's email: whether it is confirmed, and whether the server can send to it at all.</summary>
public sealed record AccountEmailView(string? Email, bool Confirmed, bool MailWorks, bool? Sent = null, string? Problem = null);

/// <summary>
/// Email for people's own accounts (PL-122): an email on the account, confirmed by a link, and
/// password reset links, from the sign-in page or sent by an admin. All of it needs email set up
/// (<c>SMTP_HOST</c>) and <c>PUBLIC_URL</c>: links are never built from the address a request came
/// in on, which anyone can send.
/// </summary>
public static class EmailEndpoints
{
    /// <summary>One reset email per account in this window, however often it is asked for.</summary>
    private static readonly TimeSpan ResetEvery = TimeSpan.FromMinutes(2);

    /// <summary>Whether links can go out: email is set up and the server knows its public address.</summary>
    public static bool LinksWork(IMailSender mail, LiveSettings live) => mail.Configured && live.Current.PublicUrl is not null;

    /// <summary>Whether the sign-in page offers "Forgot your password?".</summary>
    public static bool ResetsWork(IMailSender mail, LiveSettings live) => LinksWork(mail, live) && !live.Current.LocalLoginDisabled;

    private static string Origin(LiveSettings live) => live.Current.PublicUrl!.ToString().TrimEnd('/');

    private static string ServerName(LiveSettings live) => live.Current.PublicUrl?.Host ?? "your server";

    /// <summary>Send a reset link to an account's confirmed email.</summary>
    internal static async Task SendResetAsync(Account account, AccountEmails emails, IMailSender mail, LiveSettings live, CancellationToken cancellation)
    {
        var token = await emails.ResetTokenAsync(account, cancellation);
        await mail.SendAsync(MailTemplates.Reset(account.VerifiedEmail!, ServerName(live), account.Username,
            $"{Origin(live)}/reset/{token}", AccountEmails.ResetLifetime), cancellation);
    }

    private static async Task SendConfirmAsync(Account account, AccountEmails emails, IMailSender mail, LiveSettings live, CancellationToken cancellation)
    {
        var token = await emails.ConfirmTokenAsync(account, cancellation);
        await mail.SendAsync(MailTemplates.Confirm(account.Email!, ServerName(live), account.Username,
            $"{Origin(live)}/auth/confirm-email/{token}"), cancellation);
    }

    /// <summary><c>/auth/forgot</c>, <c>/auth/reset</c> and <c>/auth/confirm-email</c>: reached signed out.</summary>
    public static void MapEmailAuth(this RouteGroupBuilder auth)
    {
        // The same answer whether or not an account matched, and the mail goes out after it, so
        // neither the words nor the time taken tell who has an account here.
        auth.MapPost("/forgot", (ForgotRequest request, AccountEmails emails, IMailSender mail, LiveSettings live, IMemoryCache cache,
            ILoggerFactory logs, HttpContext context) =>
        {
            var login = (request.Login ?? "").Trim();
            context.Audit().On(null, login.Length > 100 ? login[..100] : login).Anonymous = true;
            if (!ResetsWork(mail, live)) return Results.NotFound(new AuthError("reset_unavailable"));
            if (login.Length > 0)
            {
                var logger = logs.CreateLogger("PeckList.Mail");
                _ = Task.Run(async () =>
                {
                    try
                    {
                        foreach (var account in await emails.ResetRecipientsAsync(login))
                        {
                            if (cache.TryGetValue($"reset-sent:{account.Id}", out _)) continue;
                            cache.Set($"reset-sent:{account.Id}", true, ResetEvery);
                            await SendResetAsync(account, emails, mail, live, CancellationToken.None);
                            logger.LogInformation("Sent a password reset link for {Username}", account.Username);
                        }
                    }
                    catch (Exception error)
                    {
                        logger.LogError(error, "Could not send a password reset link");
                    }
                });
            }
            return Results.Accepted();
        }).RequireRateLimiting(AuthSetup.LoginRateLimit).Audited("auth.reset-requested", targetRoute: null);

        auth.MapGet("/reset/{token}", async (string token, AccountEmails emails, CancellationToken cancellation) =>
            await emails.ResetAccountAsync(token, cancellation) is { } account
                ? Results.Ok(new ResetLinkInfo(account.Username))
                : Results.NotFound(new AuthError("link_expired"))).RequireRateLimiting(AuthSetup.LoginRateLimit);

        auth.MapPost("/reset", async (ResetRequest request, AccountEmails emails, AccountService accounts, IMemoryCache cache,
            LiveSettings live, HttpContext context, CancellationToken cancellation) =>
        {
            if (live.Current.LocalLoginDisabled) return Results.Json(new AuthError("local_login_disabled"), statusCode: StatusCodes.Status403Forbidden);
            if (request.Token is not { Length: > 0 } token || await emails.ResetAccountAsync(token, cancellation) is not { } account)
            {
                return Results.NotFound(new AuthError("link_expired"));
            }
            context.Audit().Actor(account);
            var (result, updated) = await accounts.ResetOwnPasswordAsync(account.Id, request.Password ?? "", cancellation);
            if (result != PasswordChange.Changed)
            {
                return Results.BadRequest(new AuthError(result == PasswordChange.TooShort ? "too_short" : "demo_account"));
            }
            await emails.SpendResetAsync(token, cancellation);
            // Every session of the account ends: the stamp changed.
            AuthSetup.ForgetStamp(cache, updated!.Id);
            return Results.Ok(new ResetLinkInfo(updated.Username));
        }).RequireRateLimiting(AuthSetup.LoginRateLimit).Audited("auth.password-reset", targetRoute: null);

        auth.MapGet("/confirm-email/{token}", async (string token, AccountEmails emails, HttpContext context, CancellationToken cancellation) =>
        {
            if (await emails.ConfirmAsync(token, cancellation) is not { } account)
            {
                context.Audit().Outcome = AuditOutcome.Failed;
                return Results.Redirect("/settings?email=expired");
            }
            context.Audit().Actor(account).On(null, account.Email);
            return Results.Redirect("/settings?email=confirmed");
        }).RequireRateLimiting(AuthSetup.LoginRateLimit).Audited("account.email-confirmed", targetRoute: null);
    }

    /// <summary><c>/api/account/email</c>: the signed-in person's own email.</summary>
    public static RouteGroupBuilder MapAccountEmail(this RouteGroupBuilder api)
    {
        api.MapGet("/account/email", async (ClaimsPrincipal user, IAccountStore accounts, IMailSender mail, LiveSettings live, CancellationToken cancellation) =>
            await accounts.FindByIdAsync(user.UserId(), cancellation) is { } account
                ? Results.Ok(new AccountEmailView(account.Email, account.EmailVerifiedAt is not null, LinksWork(mail, live)))
                : Results.NotFound());

        api.MapPut("/account/email", async (EmailRequest request, ClaimsPrincipal user, AccountEmails emails, IMailSender mail, LiveSettings live,
            HttpContext context, CancellationToken cancellation) =>
        {
            // Viewing as someone never changes their account (audit C4).
            if (user.Impersonator() is not null) return Results.Json(new AuthError("not_while_impersonating"), statusCode: StatusCodes.Status403Forbidden);
            Account before = (await context.RequestServices.GetRequiredService<IAccountStore>().FindByIdAsync(user.UserId(), cancellation))!;
            Account account;
            try
            {
                account = await emails.SetAsync(user.UserId(), request.Email, cancellation);
            }
            catch (ArgumentException)
            {
                return Results.BadRequest(new AuthError("invalid_email"));
            }
            context.Audit().On(null, account.Email ?? "(removed)");
            if (account.Email == before.Email) return Results.Ok(new AccountEmailView(account.Email, account.EmailVerifiedAt is not null, LinksWork(mail, live)));
            return Results.Ok(await ConfirmViewAsync(account, emails, mail, live, cancellation));
        }).Audited("account.email-changed", targetRoute: null);

        api.MapPost("/account/email/confirm", async (ClaimsPrincipal user, IAccountStore accounts, AccountEmails emails, IMailSender mail,
            LiveSettings live, CancellationToken cancellation) =>
        {
            if (await accounts.FindByIdAsync(user.UserId(), cancellation) is not { Email: not null, EmailVerifiedAt: null } account)
            {
                return Results.Conflict(new AuthError("nothing_to_confirm"));
            }
            return Results.Ok(await ConfirmViewAsync(account, emails, mail, live, cancellation));
        }).RequireRateLimiting(AuthSetup.LoginRateLimit);

        return api;
    }

    /// <summary>Send the confirmation link when there is an email to confirm and mail works; the view says how it went.</summary>
    private static async Task<AccountEmailView> ConfirmViewAsync(Account account, AccountEmails emails, IMailSender mail, LiveSettings live,
        CancellationToken cancellation)
    {
        var works = LinksWork(mail, live);
        if (account.Email is null || !works) return new AccountEmailView(account.Email, false, works);
        try
        {
            await SendConfirmAsync(account, emails, mail, live, cancellation);
            return new AccountEmailView(account.Email, false, works, Sent: true);
        }
        catch (MailException error)
        {
            return new AccountEmailView(account.Email, false, works, Sent: false, Problem: error.Message);
        }
    }

    /// <summary><c>/api/admin/users/{id}/reset-link</c>: an admin sends someone a reset link.</summary>
    public static RouteGroupBuilder MapAdminEmail(this RouteGroupBuilder admin)
    {
        admin.MapPost("/users/{id}/reset-link", async (string id, ClaimsPrincipal user, IAccountStore store, AccountEmails emails, IMailSender mail,
            LiveSettings live, HttpContext context, CancellationToken cancellation) =>
            await AdminEndpoints.OnAccountAsync(id, user, store, async account =>
            {
                if (!LinksWork(mail, live)) return Results.Conflict(new AdminError("mail_not_set_up", "Set up email and PUBLIC_URL first."));
                if (account.VerifiedEmail is null) return Results.Conflict(new AdminError("no_confirmed_email", "This person has no confirmed email."));
                try
                {
                    await SendResetAsync(account, emails, mail, live, cancellation);
                    context.Audit().Detail = account.VerifiedEmail;
                    return Results.NoContent();
                }
                catch (MailException error)
                {
                    return Results.Json(new AdminError("mail_failed", error.Message), statusCode: StatusCodes.Status502BadGateway);
                }
            }, cancellation)).RequirePermission(Permission.ManageUsers).Audited("admin.reset-link-sent");
        return admin;
    }
}
