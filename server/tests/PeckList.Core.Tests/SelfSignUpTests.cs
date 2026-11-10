using PeckList.Core.Accounts;
using PeckList.Core.Configuration;

namespace PeckList.Core.Tests;

/// <summary>Named values in memory.</summary>
public sealed class MemorySecretStore : ISecretStore
{
    private readonly Dictionary<(string Kind, string Name), string> values = [];

    public Task<IReadOnlyList<(string Name, string Value)>> ListAsync(string kind, CancellationToken cancellation = default) =>
        Task.FromResult<IReadOnlyList<(string, string)>>(values.Where(each => each.Key.Kind == kind).Select(each => (each.Key.Name, each.Value)).ToList());

    public Task<IReadOnlyList<(string Kind, string Name, string Value)>> AllAsync(CancellationToken cancellation = default) =>
        Task.FromResult<IReadOnlyList<(string, string, string)>>(values.Select(each => (each.Key.Kind, each.Key.Name, each.Value)).ToList());

    public Task PutAsync(string kind, string name, string value, CancellationToken cancellation = default)
    {
        values[(kind, name)] = value;
        return Task.CompletedTask;
    }

    public Task<string?> GetAsync(string kind, string name, CancellationToken cancellation = default) =>
        Task.FromResult(values.GetValueOrDefault((kind, name)));

    public Task<string?> TakeAsync(string kind, string name, CancellationToken cancellation = default) =>
        Task.FromResult(values.Remove((kind, name), out var value) ? value : null);

    public Task DeleteAsync(string kind, string name, CancellationToken cancellation = default)
    {
        values.Remove((kind, name));
        return Task.CompletedTask;
    }
}

public sealed class SelfSignUpTests
{
    private const string Password = "a long enough password";

    private readonly TestClock clock = new(new DateTimeOffset(2026, 10, 23, 12, 0, 0, TimeSpan.Zero));
    private readonly MemoryAccountStore accounts = new();
    private readonly SignupInvites invites;

    public SelfSignUpTests() => invites = new SignupInvites(new MemorySecretStore(), clock);

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private SelfSignUp SignUp(Registration registration, bool localLoginDisabled = false, AuthMode mode = AuthMode.Local) =>
        new(new AccountService(accounts, new FakeHasher(), clock), invites,
            new LiveSettings(new ServerSettings { Registration = registration, LocalLoginDisabled = localLoginDisabled, AuthMode = mode }));

    [Fact]
    public async Task Registration_decides_who_may_sign_up_without_an_invite()
    {
        Assert.IsType<SignUpResult.Success>(await SignUp(Registration.Open).SignUpAsync("ana", Password, null, Token));
        Assert.Equal(SignUpResult.InviteNeeded, await SignUp(Registration.Invite).SignUpAsync("bo", Password, null, Token));
        Assert.Equal(SignUpResult.Closed, await SignUp(Registration.Closed).SignUpAsync("bo", Password, null, Token));
        Assert.Equal(SignUpResult.Closed, await SignUp(Registration.Open, mode: AuthMode.None).SignUpAsync("bo", Password, null, Token));
        // Passwords turned off for identity providers: no password accounts either.
        Assert.Equal(SignUpResult.PasswordsDisabled, await SignUp(Registration.Open, localLoginDisabled: true).SignUpAsync("bo", Password, null, Token));
        Assert.Single(accounts.ById);
    }

    [Fact]
    public async Task A_new_account_is_a_plain_user_with_the_password_they_chose()
    {
        var made = Assert.IsType<SignUpResult.Success>(await SignUp(Registration.Open).SignUpAsync("  Ana.Lee ", Password, null, Token));
        Assert.Equal("ana.lee", made.Account.Username);
        Assert.Equal(Role.User, made.Account.Role);
        Assert.False(made.Account.MustChangePassword);
        var login = await new AccountService(accounts, new FakeHasher(), clock).LoginAsync("ana.lee", Password, Token);
        Assert.IsType<LoginResult.Success>(login);
    }

    [Fact]
    public async Task Usernames_and_passwords_are_checked_before_an_invite_is_spent()
    {
        var (token, _) = await invites.CreateAsync("admin-id", cancellation: Token);
        var signUp = SignUp(Registration.Invite);
        Assert.Equal(SignUpResult.InvalidUsername, await signUp.SignUpAsync("Ana Lee!", Password, token, Token));
        Assert.Equal(SignUpResult.TooShort, await signUp.SignUpAsync("ana", "short", token, Token));
        await new AccountService(accounts, new FakeHasher(), clock).CreateUserAsync("taken", Password, cancellation: Token);
        Assert.Equal(SignUpResult.UsernameTaken, await signUp.SignUpAsync("taken", Password, token, Token));
        Assert.IsType<SignUpResult.Success>(await signUp.SignUpAsync("ana", Password, token, Token));
    }

    [Fact]
    public async Task An_invite_works_for_as_many_people_as_it_says_until_it_expires()
    {
        var signUp = SignUp(Registration.Invite);
        var (once, _) = await invites.CreateAsync("admin-id", cancellation: Token);
        var (twice, _) = await invites.CreateAsync("admin-id", maxUses: 2, cancellation: Token);
        var (anyNumber, _) = await invites.CreateAsync("admin-id", TimeSpan.FromDays(1), maxUses: null, cancellation: Token);

        Assert.IsType<SignUpResult.Success>(await signUp.SignUpAsync("a1", Password, once, Token));
        Assert.Equal(SignUpResult.InviteInvalid, await signUp.SignUpAsync("a2", Password, once, Token));

        Assert.IsType<SignUpResult.Success>(await signUp.SignUpAsync("b1", Password, twice, Token));
        var left = Assert.Single(await invites.ListAsync(Token), invite => invite.MaxUses == 2);
        Assert.Equal(1, left.Uses);
        Assert.Equal([accounts.ById.Values.Single(account => account.Username == "b1").Id], left.UsedBy);
        Assert.IsType<SignUpResult.Success>(await signUp.SignUpAsync("b2", Password, twice, Token));
        Assert.Equal(SignUpResult.InviteInvalid, await signUp.SignUpAsync("b3", Password, twice, Token));

        for (var each = 0; each < 5; each++)
        {
            Assert.IsType<SignUpResult.Success>(await signUp.SignUpAsync($"c{each}", Password, anyNumber, Token));
        }
        clock.Now += TimeSpan.FromDays(1);
        Assert.Equal(SignUpResult.InviteInvalid, await signUp.SignUpAsync("c9", Password, anyNumber, Token));
        Assert.Empty(await invites.ListAsync(Token));
        Assert.Equal(SignUpResult.InviteInvalid, await signUp.SignUpAsync("d1", Password, "made-up", Token));
    }

    [Fact]
    public async Task A_revoked_invite_stops_working_and_closing_sign_up_stops_them_all()
    {
        var (revoked, made) = await invites.CreateAsync("admin-id", note: "  for Sam  ", cancellation: Token);
        Assert.Equal("for Sam", made.Note);
        Assert.Equal(made.Id, (await invites.RevokeAsync(made.Id, Token))?.Id);
        Assert.Null(await invites.RevokeAsync(made.Id, Token));
        Assert.Equal(SignUpResult.InviteInvalid, await SignUp(Registration.Open).SignUpAsync("sam", Password, revoked, Token));

        var (kept, _) = await invites.CreateAsync("admin-id", cancellation: Token);
        Assert.Equal(SignUpResult.Closed, await SignUp(Registration.Closed).SignUpAsync("sam", Password, kept, Token));
        Assert.NotNull(await invites.FindAsync(kept, Token));
    }

    [Fact]
    public async Task Invites_last_between_a_minute_and_ninety_days()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => invites.CreateAsync("admin-id", TimeSpan.Zero, cancellation: Token));
        await Assert.ThrowsAsync<ArgumentException>(() => invites.CreateAsync("admin-id", TimeSpan.FromDays(91), cancellation: Token));
        await Assert.ThrowsAsync<ArgumentException>(() => invites.CreateAsync("admin-id", maxUses: 0, cancellation: Token));
    }
}
