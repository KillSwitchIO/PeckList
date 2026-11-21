using System.Text.Json.Nodes;

namespace PeckList.Core.Tests;

/// <summary>
/// THIRD-PARTY-NOTICES.md names every NuGet package the server's projects ship: scripts/third-party.json
/// lists them by hand (reading them needs the .NET SDK, which the Node checks don't have), and this
/// checks that list against what each project under server/src restored, transitive packages too.
/// scripts/notices.mjs checks the licenses and makes the file. CI's shard 3 builds the whole
/// solution before it runs this, so every project's obj/project.assets.json is there.
/// </summary>
public sealed class ThirdPartyNoticesTests
{
    // The .NET runtime packs a self-contained publish adds (the CLI's): the platform, listed in the
    // notices on its own, not a package of ours.
    private static readonly string[] RuntimePacks =
        ["Microsoft.NETCore.App.Runtime.", "Microsoft.AspNetCore.App.Runtime.", "Microsoft.NETCore.App.Host.", "runtime."];

    private static SortedSet<string> Restored()
    {
        var src = RepoFiles.Path("server", "src");
        var names = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var project in Directory.GetDirectories(src))
        {
            var assets = Path.Combine(project, "obj", "project.assets.json");
            Assert.True(File.Exists(assets), $"{assets} is missing: build the whole solution first (dotnet build in server/)");
            var libraries = JsonNode.Parse(File.ReadAllText(assets))!["libraries"]!.AsObject();
            foreach (var (key, library) in libraries)
            {
                if ((string?)library!["type"] != "package") continue;
                var name = key[..key.IndexOf('/', StringComparison.Ordinal)];
                if (!RuntimePacks.Any(prefix => name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))) names.Add(name);
            }
        }
        return names;
    }

    private static SortedSet<string> Listed() =>
        new(JsonNode.Parse(File.ReadAllText(RepoFiles.Path("scripts", "third-party.json")))!["nuget"]!.AsObject().Select(each => each.Key),
            StringComparer.OrdinalIgnoreCase);

    [Fact]
    public void Every_package_the_server_projects_restore_is_in_the_notices()
    {
        var missing = Restored().Except(Listed(), StringComparer.OrdinalIgnoreCase).ToList();
        Assert.True(missing.Count == 0,
            $"Not in scripts/third-party.json (add each with its license from nuget.org, then run node scripts/notices.mjs): {string.Join(", ", missing)}");
    }

    [Fact]
    public void The_notices_name_no_package_the_server_no_longer_uses()
    {
        var gone = Listed().Except(Restored(), StringComparer.OrdinalIgnoreCase).ToList();
        Assert.True(gone.Count == 0,
            $"In scripts/third-party.json but no longer restored (take each out, then run node scripts/notices.mjs): {string.Join(", ", gone)}");
    }
}
