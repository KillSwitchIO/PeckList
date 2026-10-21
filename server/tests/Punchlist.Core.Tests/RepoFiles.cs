namespace Punchlist.Core.Tests;

/// <summary>Files shared with the web app (schema, fixtures), found from the test's folder up.</summary>
public static class RepoFiles
{
    public static string Path(params string[] parts)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (Directory.Exists(System.IO.Path.Combine(dir.FullName, "schema", "fixtures")))
            {
                return System.IO.Path.Combine([dir.FullName, .. parts]);
            }
        }
        throw new DirectoryNotFoundException("repo root (with schema/fixtures) not found above " + AppContext.BaseDirectory);
    }
}
