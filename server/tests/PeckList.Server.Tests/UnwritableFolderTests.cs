using PeckList.Core.Configuration;

namespace PeckList.Server.Tests;

/// <summary>A folder the server can't write stops it with one line naming the folder and the fix (QA pass 5).</summary>
public sealed class UnwritableFolderTests : IDisposable
{
    private readonly string folder = Directory.CreateTempSubdirectory("pecklist-unwritable-").FullName;

    public void Dispose() => Directory.Delete(folder, recursive: true);

    private ServerSettings Settings(params (string Name, string Value)[] more)
    {
        var env = new Dictionary<string, string>
        {
            ["DB_PATH"] = Path.Combine(folder, "data", "pecklist.db"),
            ["ATTACHMENT_DIR"] = Path.Combine(folder, "files"),
            ["LOG_DIR"] = Path.Combine(folder, "logs"),
            ["SNAPSHOT_DIR"] = Path.Combine(folder, "snapshots"),
        };
        foreach (var (name, value) in more) env[name] = value;
        return ServerSettings.Read(new FileAwareSecretSource(name => env.GetValueOrDefault(name), path => throw new FileNotFoundException(path)), inContainer: true);
    }

    [Fact]
    public void Folders_it_can_write_pass_and_missing_ones_are_made()
    {
        Assert.Null(StartupChecks.UnwritableFolder(Settings()));
        Assert.True(Directory.Exists(Path.Combine(folder, "data")));
        Assert.True(Directory.Exists(Path.Combine(folder, "files")));
        // The check leaves nothing behind.
        Assert.Empty(Directory.GetFiles(Path.Combine(folder, "data")));
    }

    [Fact]
    public void A_folder_it_cannot_write_gives_one_line_with_the_folder_the_setting_and_the_fix()
    {
        // Root in the test container can write anywhere, so stand a file where the folder should be.
        var blocked = Path.Combine(folder, "files");
        File.WriteAllText(blocked, "not a folder");

        var line = StartupChecks.UnwritableFolder(Settings());

        Assert.NotNull(line);
        Assert.StartsWith($"PeckList cannot write to {blocked} (ATTACHMENT_DIR): ", line);
        Assert.Contains("chown -R 1654:1654", line);
        Assert.Contains("https://docs.pecklist.com/guides/troubleshooting#it-does-not-start", line);
        Assert.DoesNotContain('\n', line);
    }

    [Fact]
    public void Snapshots_count_only_when_they_are_on()
    {
        File.WriteAllText(Path.Combine(folder, "snapshots"), "not a folder");
        Assert.Contains("(SNAPSHOT_DIR)", StartupChecks.UnwritableFolder(Settings()));
        Assert.Null(StartupChecks.UnwritableFolder(Settings(("SNAPSHOT_SCHEDULE", "off"))));
    }

    [Fact]
    public void A_refused_write_elsewhere_reads_the_same_way()
    {
        var line = StartupChecks.UnwritableText(new UnauthorizedAccessException("Access to the path '/data/keys' is denied."));
        Assert.StartsWith("PeckList cannot write a file it needs: Access to the path '/data/keys' is denied. ", line);
        Assert.Contains("uid 1654", line);
    }
}
