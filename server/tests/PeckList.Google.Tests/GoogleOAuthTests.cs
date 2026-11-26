using PeckList.Calendars.Testing;
using PeckList.Core.Calendars;

namespace PeckList.Google.Tests;

/// <summary>The sign-in's OAuth steps against the fake: the address, the code swap with PKCE, the scopes.</summary>
public sealed class GoogleOAuthTests
{
    private const string Redirect = "https://pecklist.example.com/auth/calendar/google/callback";
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static readonly GoogleClient Client = new(GoogleRig.ClientId, GoogleRig.ClientSecret, Relay: false);

    [Fact]
    public void The_sign_in_address_asks_for_offline_access_the_three_scopes_and_PKCE()
    {
        var rig = new GoogleRig();

        var url = rig.Provider.OAuth.AuthorizeUrl(Client, Redirect, "the-state", "the-challenge");

        var query = url.Query;
        Assert.StartsWith(FakeGoogle.AuthorizeUrl.AbsoluteUri, url.AbsoluteUri, StringComparison.Ordinal);
        Assert.Contains("client_id=" + Uri.EscapeDataString(GoogleRig.ClientId), query, StringComparison.Ordinal);
        Assert.Contains("redirect_uri=" + Uri.EscapeDataString(Redirect), query, StringComparison.Ordinal);
        Assert.Contains("access_type=offline", query, StringComparison.Ordinal);
        Assert.Contains("prompt=consent", query, StringComparison.Ordinal);
        Assert.Contains("code_challenge=the-challenge", query, StringComparison.Ordinal);
        Assert.Contains("code_challenge_method=S256", query, StringComparison.Ordinal);
        Assert.Contains("scope=" + Uri.EscapeDataString(GoogleScopes.All), query, StringComparison.Ordinal);
        Assert.Contains("state=the-state", query, StringComparison.Ordinal);
        Assert.DoesNotContain(GoogleRig.ClientSecret, url.AbsoluteUri, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_code_is_swapped_for_tokens_with_the_matching_verifier_once()
    {
        var rig = new GoogleRig();
        const string verifier = "a-verifier-of-enough-length-0123456789abcdefghij";
        var code = rig.Google.IssueCode(rig.Address, GoogleRig.ClientId, Redirect, FakeGoogle.Challenge(verifier));

        var token = await rig.Provider.OAuth.ExchangeAsync(Client, code, Redirect, verifier, Cancel);

        Assert.Equal(GoogleRig.ClientId, token.ClientId);
        Assert.True(GoogleScopes.Granted(token.Scope));
        var again = await Assert.ThrowsAsync<CalendarProblem>(() => rig.Provider.OAuth.ExchangeAsync(Client, code, Redirect, verifier, Cancel));
        Assert.Equal(CalendarProblemKind.Auth, again.Kind);
    }

    [Fact]
    public async Task A_code_without_its_verifier_is_refused()
    {
        var rig = new GoogleRig();
        var code = rig.Google.IssueCode(rig.Address, GoogleRig.ClientId, Redirect, FakeGoogle.Challenge("the-real-verifier-0123456789abcdefghijklmnop"));

        var problem = await Assert.ThrowsAsync<CalendarProblem>(() =>
            rig.Provider.OAuth.ExchangeAsync(Client, code, Redirect, "an-attackers-guess-0123456789abcdefghijklmnop", Cancel));

        Assert.Equal("calendar_auth_failed", problem.Code);
    }

    [Theory]
    [InlineData(FakeGoogle.AllScopes, true)]
    [InlineData(FakeGoogle.EventsScope + " " + FakeGoogle.CalendarListScope, false)]
    [InlineData("", false)]
    public void Every_scope_must_be_granted(string scope, bool granted) => Assert.Equal(granted, GoogleScopes.Granted(scope));
}
