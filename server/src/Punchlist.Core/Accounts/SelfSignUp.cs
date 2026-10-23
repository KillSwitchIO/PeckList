using Punchlist.Core.Configuration;

namespace Punchlist.Core.Accounts;

public abstract record SignUpResult
{
    public sealed record Success(Account Account) : SignUpResult;

    /// <summary>Error codes the API answers with, one per refusal.</summary>
    public sealed record Refused(string Error) : SignUpResult;

    public static readonly Refused Closed = new("registration_closed");
    public static readonly Refused InviteNeeded = new("invite_required");
    public static readonly Refused InviteInvalid = new("invite_invalid");
    public static readonly Refused PasswordsHidden = new("local_login_hidden");
    public static readonly Refused InvalidUsername = new("invalid_username");
    public static readonly Refused TooShort = new("too_short");
    public static readonly Refused UsernameTaken = new("username_taken");
}

/// <summary>
/// People making their own account (spec: Accounts &amp; Admin, Registration). <c>REGISTRATION</c>
/// decides who may: <c>open</c> anyone, <c>invite</c> only with an invite link, <c>closed</c> nobody
/// (admins add people). Identity providers keep their own switch (<c>OIDC_&lt;NAME&gt;_AUTO_CREATE</c>);
/// an invite link also lets a provider's new sign-in in when that switch is off.
/// </summary>
public sealed class SelfSignUp(AccountService accounts, SignupInvites invites, ServerSettings settings)
{
    public Registration Policy => settings.Registration;

    /// <summary>Whether invite links work at all: not while sign-up is closed.</summary>
    public bool InvitesWork => settings.AuthMode == AuthMode.Local && settings.Registration != Registration.Closed;

    /// <summary>Whether this server offers a password sign-up form: open, or with an invite.</summary>
    public bool PasswordSignUp => InvitesWork && !settings.LocalLoginHidden;

    public async Task<SignUpResult> SignUpAsync(string username, string password, string? invite, CancellationToken cancellation = default)
    {
        if (!InvitesWork) return SignUpResult.Closed;
        if (settings.LocalLoginHidden) return SignUpResult.PasswordsHidden;
        var hasInvite = !string.IsNullOrWhiteSpace(invite);
        if (!hasInvite && settings.Registration != Registration.Open) return SignUpResult.InviteNeeded;
        username = username.Trim().ToLowerInvariant();
        if (!AccountService.IsValidUsername(username)) return SignUpResult.InvalidUsername;
        if (password.Length < AccountService.MinPasswordLength) return SignUpResult.TooShort;

        Task<Account> Create() => accounts.CreateUserAsync(username, password, Role.User, mustChangePassword: false, cancellation);
        try
        {
            if (!hasInvite) return new SignUpResult.Success(await Create());
            return await invites.UseAsync(invite!, Create, account => account.Id, cancellation) is { } made
                ? new SignUpResult.Success(made)
                : SignUpResult.InviteInvalid;
        }
        catch (DuplicateUsernameException)
        {
            return SignUpResult.UsernameTaken;
        }
    }
}
