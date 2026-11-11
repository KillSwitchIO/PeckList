using System.Text.Json.Nodes;
using PeckList.Client;

namespace PeckList.Client.Tests;

/// <summary>What every <see cref="ITokenStore"/> adapter must do (PL-133).</summary>
public abstract class TokenStoreContract : IDisposable
{
    protected static CancellationToken Token => TestContext.Current.CancellationToken;

    protected abstract ITokenStore Store { get; }

    public virtual void Dispose() => GC.SuppressFinalize(this);

    [Fact]
    public async Task Keeps_profiles_apart_and_forgets_one_when_asked()
    {
        Assert.Null(await Store.LoadAsync("default", Token));
        var home = new CliProfile("https://tasks.example.com", "pl_abc_secret1", "abc", "ben");
        var work = new CliProfile("https://work.example.com", "pl_def_secret2", "def", "ben.k");
        await Store.SaveAsync("default", home, Token);
        await Store.SaveAsync("work", work, Token);

        Assert.Equal(home, await Store.LoadAsync("default", Token));
        Assert.Equal(work, await Store.LoadAsync("work", Token));

        var replaced = home with { Token = "pl_ghi_secret3", KeyId = "ghi" };
        await Store.SaveAsync("default", replaced, Token);
        Assert.Equal(replaced, await Store.LoadAsync("default", Token));

        Assert.True(await Store.RemoveAsync("default", Token));
        Assert.False(await Store.RemoveAsync("default", Token));
        Assert.Null(await Store.LoadAsync("default", Token));
        Assert.Equal(work, await Store.LoadAsync("work", Token));
    }
}

public sealed class MemoryTokenStoreTests : TokenStoreContract
{
    protected override ITokenStore Store { get; } = new MemoryTokenStore();
}

public sealed class FileTokenStoreTests : TokenStoreContract
{
    private readonly string folder = Directory.CreateTempSubdirectory("pecklist-cli-").FullName;
    private readonly FileTokenStore store;

    public FileTokenStoreTests() =>
        store = new FileTokenStore(Path.Combine(folder, "pecklist", "cli.json"), OperatingSystem.IsWindows() ? new DpapiProtector() : new PlainProtector());

    protected override ITokenStore Store => store;

    public override void Dispose()
    {
        Directory.Delete(folder, recursive: true);
        base.Dispose();
    }

    [Fact]
    public async Task Is_only_the_owners_on_unix_and_refuses_a_file_others_can_read()
    {
        if (OperatingSystem.IsWindows()) Assert.Skip("Unix file modes");
        else await UnixModesAsync();
    }

    [System.Runtime.Versioning.UnsupportedOSPlatform("windows")]
    private async Task UnixModesAsync()
    {
        await store.SaveAsync("default", new CliProfile("https://tasks.example.com", "pl_abc_secret", "abc", "ben"), Token);
        Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(store.Path));
        Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute, File.GetUnixFileMode(Path.GetDirectoryName(store.Path)!));
        Assert.Empty(Directory.GetFiles(Path.GetDirectoryName(store.Path)!, "*.tmp"));

        File.SetUnixFileMode(store.Path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead);
        var refused = await Assert.ThrowsAsync<TokenFileException>(() => store.LoadAsync("default", Token));
        Assert.Contains("chmod 600", refused.Message);

        // A folder others could write to (made earlier, or by hand) is closed on the next save.
        File.SetUnixFileMode(store.Path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        var folder = Path.GetDirectoryName(store.Path)!;
        File.SetUnixFileMode(folder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupWrite | UnixFileMode.OtherWrite | UnixFileMode.OtherExecute);
        await store.SaveAsync("default", new CliProfile("https://tasks.example.com", "pl_abc_secret2", "abc", "ben"), Token);
        Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute, File.GetUnixFileMode(folder));
        Assert.Empty(Directory.GetFiles(folder, "*.tmp"));
    }

    [Fact]
    public async Task Never_writes_the_token_as_it_is_on_windows()
    {
        if (!OperatingSystem.IsWindows()) Assert.Skip("DPAPI is Windows only");
        await store.SaveAsync("default", new CliProfile("https://tasks.example.com", "pl_abc_secret", "abc", "ben"), Token);
        var written = await File.ReadAllTextAsync(store.Path, Token);
        Assert.DoesNotContain("pl_abc_secret", written);
        Assert.StartsWith(DpapiProtector.Prefix, (string?)JsonNode.Parse(written)!["profiles"]!["default"]!["token"]);
    }

    [Fact]
    public async Task A_damaged_file_says_so()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(store.Path)!);
        await File.WriteAllTextAsync(store.Path, "{not json", Token);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(store.Path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        var damaged = await Assert.ThrowsAsync<TokenFileException>(() => store.LoadAsync("default", Token));
        Assert.Contains("damaged", damaged.Message);
    }
}
