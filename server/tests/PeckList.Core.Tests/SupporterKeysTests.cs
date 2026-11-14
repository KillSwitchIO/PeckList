using PeckList.Core.Supporters;

namespace PeckList.Core.Tests;

/// <summary>The supporter keys a server keeps (PL-112), with a stand-in for the signature check.</summary>
public sealed class SupporterKeysTests
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    /// <summary>Genuine when the signature starts with 1: the real check is the server's (SupporterKeyCheckTests).</summary>
    private sealed class FirstByteCheck : ISupporterKeyCheck
    {
        public bool IsGenuine(SupporterKey key) => key.Signature[0] == 1;
    }

    private readonly MemorySecretStore secrets = new();
    private readonly SupporterKeys keys;

    public SupporterKeysTests() => keys = new SupporterKeys(secrets, new FirstByteCheck());

    private static string Text(SupporterKind kind, bool genuine = true) =>
        new SupporterKey(new DateOnly(2026, 11, 11), kind, [1, 2, 3, 4, 5, 6, 7, 8],
            [(byte)(genuine ? 1 : 0), .. new byte[SupporterKey.SignatureBytes - 1]]).Text;

    [Fact]
    public async Task A_person_key_is_kept_for_that_person_only()
    {
        var (result, key) = await keys.EnterAsync("sam", Text(SupporterKind.Person), Token);
        Assert.Equal(SupporterEntry.Saved, result);
        Assert.Equal(new DateOnly(2026, 11, 11), key!.Purchased);
        Assert.NotNull(await keys.PersonAsync("sam", Token));
        Assert.Null(await keys.PersonAsync("kim", Token));
        Assert.Null(await keys.ServerAsync(Token));
    }

    [Fact]
    public async Task A_server_key_is_kept_for_the_server()
    {
        Assert.Equal(SupporterEntry.Saved, (await keys.EnterAsync(null, Text(SupporterKind.Server), Token)).Result);
        Assert.Equal(SupporterKind.Server, (await keys.ServerAsync(Token))?.Kind);
    }

    [Fact]
    public async Task Each_kind_goes_only_where_it_belongs()
    {
        Assert.Equal(SupporterEntry.WrongKind, (await keys.EnterAsync("sam", Text(SupporterKind.Server), Token)).Result);
        Assert.Equal(SupporterEntry.WrongKind, (await keys.EnterAsync(null, Text(SupporterKind.Person), Token)).Result);
        Assert.Empty(await secrets.AllAsync(Token));
    }

    [Fact]
    public async Task Text_that_is_not_a_key_or_a_key_nobody_signed_is_not_kept()
    {
        Assert.Equal(SupporterEntry.NotAKey, (await keys.EnterAsync("sam", "PECKLIST-NOPE", Token)).Result);
        Assert.Equal(SupporterEntry.NotGenuine, (await keys.EnterAsync("sam", Text(SupporterKind.Person, genuine: false), Token)).Result);
        Assert.Empty(await secrets.AllAsync(Token));
    }

    [Fact]
    public async Task A_stored_key_that_no_longer_checks_out_reads_as_none()
    {
        await secrets.PutAsync(SupporterKeys.Kind, SupporterKeys.PersonName("sam"), Text(SupporterKind.Person, genuine: false), Token);
        await secrets.PutAsync(SupporterKeys.Kind, SupporterKeys.ServerName, "garbled", Token);
        Assert.Null(await keys.PersonAsync("sam", Token));
        Assert.Null(await keys.ServerAsync(Token));
    }

    [Fact]
    public async Task Removing_forgets_only_the_one_asked_for()
    {
        await keys.EnterAsync("sam", Text(SupporterKind.Person), Token);
        await keys.EnterAsync(null, Text(SupporterKind.Server), Token);
        await keys.RemoveAsync("sam", Token);
        Assert.Null(await keys.PersonAsync("sam", Token));
        Assert.NotNull(await keys.ServerAsync(Token));
        await keys.RemoveAsync(null, Token);
        await keys.RemoveAsync(null, Token);
        Assert.Null(await keys.ServerAsync(Token));
    }
}
