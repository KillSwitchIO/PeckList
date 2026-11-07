using PeckList.Core.Configuration;

namespace PeckList.Core.Tests;

public sealed class OidcUserMapTests
{
    private static (OidcProviderSettings? Provider, List<string> Errors) Read(string userMap)
    {
        var values = new Dictionary<string, string>
        {
            ["OIDC_PROVIDERS"] = "pocket",
            ["OIDC_POCKET_AUTHORITY"] = "https://id.example.com",
            ["OIDC_POCKET_CLIENT_ID"] = "pecklist",
            ["OIDC_POCKET_USER_MAP"] = userMap,
        };
        var errors = new List<string>();
        var providers = OidcProviderSettings.ReadAll(key => values.GetValueOrDefault(key), errors);
        return (providers.SingleOrDefault(), errors);
    }

    [Theory]
    [InlineData("sub:abc123=ben", "abc123")]
    [InlineData("sub:auth0|abc=ben", "auth0|abc")]
    [InlineData("sub:AbC=ben", "AbC")]
    [InlineData("sub:abc==ben", "abc=")]
    [InlineData("sub:a=b=ben", "a=b")]
    [InlineData("SUB:abc=ben", "abc")]
    [InlineData(" sub: abc = BEN ", "abc")]
    public void A_sub_entry_is_a_subject_kept_exactly(string entry, string subject)
    {
        var (provider, errors) = Read(entry);
        Assert.Empty(errors);
        Assert.Equal("ben", provider!.SubjectMap[subject]);
        Assert.Empty(provider.UserMap);
    }

    [Theory]
    [InlineData("Kim.Lee=KIM", "kim.lee", "kim")]
    [InlineData("auth0|abc=kim", "auth0|abc", "kim")]
    public void Anything_else_is_a_username_ignoring_case(string entry, string username, string account)
    {
        var (provider, errors) = Read(entry);
        Assert.Empty(errors);
        Assert.Equal(account, provider!.UserMap[username]);
        Assert.Empty(provider.SubjectMap);
    }

    [Fact]
    public void Both_forms_can_share_the_list()
    {
        var (provider, errors) = Read("sub:abc=ben, kim.lee=kim");
        Assert.Empty(errors);
        Assert.Equal("ben", provider!.SubjectMap["abc"]);
        Assert.Equal("kim", provider.UserMap["kim.lee"]);
    }

    [Theory]
    [InlineData("sub:a,b=ben", "link that account by hand")]
    [InlineData("sub:abc", "link that account by hand")]
    [InlineData("sub:=ben", "is not sub:subject=pecklistuser")]
    [InlineData("sub:abc=", "is not sub:subject=pecklistuser")]
    [InlineData("sub:", "is not sub:subject=pecklistuser")]
    [InlineData("kim", "is not provideruser=pecklistuser")]
    [InlineData("=kim", "is not provideruser=pecklistuser")]
    [InlineData("kim=", "is not provideruser=pecklistuser")]
    [InlineData("sub:abc=ben,sub:abc=kim", "listed twice")]
    [InlineData("a=b=kim", "has a username holding =")]
    [InlineData("sub:CN=Kim,OU=Staff=ben", "has a username holding =")]
    public void What_cannot_be_read_is_a_settings_error(string entry, string says)
    {
        var (_, errors) = Read(entry);
        Assert.Contains(errors, error => error.Contains("OIDC_POCKET_USER_MAP") && error.Contains(says));
    }
}
