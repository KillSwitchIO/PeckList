using System.Diagnostics;

namespace PeckList.Client.Tests;

/// <summary>
/// The command table's rules (PL-138), and the files made from it: the docs' client command
/// reference and the completion scripts. When the table changes, refresh them with
/// <c>PECKLIST_WRITE_GENERATED=1 dotnet test --filter CommandTableTests</c> (in <c>server/</c>) and
/// commit the result; CI fails while they differ.
/// </summary>
public sealed class CommandTableTests
{
    private static IEnumerable<CliCommand> Visible => CommandTable.Commands.Where(command => !command.Hidden);

    public static TheoryData<string> Paths() => [.. Visible.Select(command => command.Path)];

    [Theory]
    [MemberData(nameof(Paths))]
    public void Every_command_has_a_summary_examples_and_help_naming_each_of_its_options(string path)
    {
        var command = CommandTable.Find(path)!;
        Assert.False(string.IsNullOrWhiteSpace(command.Summary));
        Assert.NotEmpty(command.Examples);
        Assert.All(command.Examples, example => Assert.Contains("pecklist", example));
        Assert.DoesNotContain('—', command.Summary + command.Details + string.Concat(command.Examples));
        var help = Help.For(command);
        Assert.Contains("usage: pecklist", help);
        if (path.Length > 0)
        {
            Assert.Contains("Examples:", help);
            Assert.Contains($"Docs: {CommandTable.DocsUrl}#{command.Anchor}", help);
        }
        foreach (var use in command.Options) Assert.Contains(CommandTable.Option(use.Long)!.Display, help);
    }

    [Fact]
    public void A_letter_means_one_option_everywhere_and_no_command_names_an_option_twice()
    {
        Assert.Equal(CommandTable.Options.Length, CommandTable.Options.Select(option => option.Long).Distinct().Count());
        var letters = CommandTable.Options.Where(option => option.Short is not null).ToList();
        Assert.Equal(letters.Count, letters.Select(option => option.Short).Distinct().Count());
        foreach (var command in CommandTable.Commands)
        {
            var names = CommandTable.OptionsOf(command).Select(each => each.Option.Long).ToList();
            Assert.Equal(names.Count, names.Distinct().Count());
            Assert.All(command.Options, use => Assert.NotNull(CommandTable.Option(use.Long)));
            var used = CommandTable.OptionsOf(command).Where(each => each.Option.Short is not null).Select(each => each.Option.Short).ToList();
            Assert.Equal(used.Count, used.Distinct().Count());
        }
        // The letters Ben agreed to (PL-138, and the task list's in PL-142), so a change to one is deliberate.
        var agreed = new Dictionary<char, string>
        {
            ['h'] = "--help", ['v'] = "--version", ['j'] = "--json", ['q'] = "--quiet", ['l'] = "--list", ['s'] = "--section",
            ['t'] = "--tag", ['a'] = "--all", ['d'] = "--due", ['p'] = "--priority", ['T'] = "--title", ['n'] = "--notes",
            ['u'] = "--assigned", ['S'] = "--search", ['o'] = "--sort", ['w'] = "--wide",
        };
        Assert.Equal(agreed.OrderBy(pair => pair.Key).ToList(), letters.ToDictionary(option => option.Short!.Value, option => option.Long).OrderBy(pair => pair.Key).ToList());
    }

    [Fact]
    public void Every_long_option_of_0_10_0_is_still_there()
    {
        string[] before =
        [
            "--server", "--profile", "--api-key", "--list", "--section", "--tag", "--status", "--due-before", "--due-after", "--title", "--notes",
            "--priority", "--due", "--start", "--repeat", "--progress", "--color", "--user",
            "--json", "--admin", "--token", "--insecure-http", "--all", "--plain", "--wontdo", "--deleted", "--help",
        ];
        Assert.All(before, name => Assert.NotNull(CommandTable.Option(name)));
    }

    [Fact]
    public void Aliases_name_their_command_and_never_shadow_another()
    {
        Assert.Equal("tasks list", CommandTable.Find("tasks ls")!.Path);
        Assert.Equal("tasks delete", CommandTable.Find("tasks rm")!.Path);
        Assert.Equal("tasks add", CommandTable.Find("add")!.Path);
        var paths = CommandTable.Commands.Select(command => command.Path).ToHashSet();
        Assert.All(CommandTable.Commands.SelectMany(command => command.Aliases), alias => Assert.DoesNotContain(alias, paths));
        Assert.Equal(("tasks add", 1), (CommandTable.Resolve(["add", "Milk"]).Command.Path, CommandTable.Resolve(["add", "Milk"]).Used));
        Assert.Equal(("tasks delete", 2), (CommandTable.Resolve(["tasks", "rm", "X"]).Command.Path, CommandTable.Resolve(["tasks", "rm", "X"]).Used));
    }

    [Fact]
    public void Each_help_page_links_to_a_section_the_docs_page_has()
    {
        var page = File.ReadAllText(Path.Combine(Cli.RepositoryRoot(), "docs", "reference", "cli.md")).ReplaceLineEndings("\n");
        foreach (var command in Visible.Where(command => command.Path.Length > 0))
        {
            var heading = command.Anchor == "remote-admin-commands" ? "### Remote admin commands\n" : $"### `{command.Path}`\n";
            Assert.True(page.Contains(heading, StringComparison.Ordinal), $"docs/reference/cli.md has no {heading.Trim()} for {command.Path}");
        }
    }

    // Made from the table -------------------------------------------------------------------------

    private static bool Writing => Environment.GetEnvironmentVariable("PECKLIST_WRITE_GENERATED") == "1";

    private static void Matches(string file, string expected)
    {
        if (Writing)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            File.WriteAllText(file, expected);
            return;
        }
        var actual = File.Exists(file) ? File.ReadAllText(file).ReplaceLineEndings("\n") : "";
        Assert.True(actual == expected,
            $"{file} differs from the command table. Refresh it: PECKLIST_WRITE_GENERATED=1 dotnet test --filter CommandTableTests (in server/).");
    }

    [Fact]
    public void The_docs_client_command_reference_is_the_table()
    {
        var file = Path.Combine(Cli.RepositoryRoot(), "docs", "reference", "cli.md");
        var page = File.ReadAllText(file).ReplaceLineEndings("\n");
        var cut = page.IndexOf("\n" + CommandDocs.Heading + "\n", StringComparison.Ordinal);
        Assert.True(cut > 0, $"docs/reference/cli.md has no line {CommandDocs.Heading}");
        var expected = page[..(cut + 1)] + CommandDocs.Render();
        Matches(file, expected);
    }

    public static TheoryData<string> Shells() => [.. CommandTable.Shells];

    private static string Script(string shell) => shell switch
    {
        "bash" => Completion.Bash(),
        "zsh" => Completion.Zsh(),
        "fish" => Completion.Fish(),
        _ => Completion.PowerShell(),
    };

    private static string SnapshotFile(string shell) =>
        Path.Combine(Cli.RepositoryRoot(), "server", "tests", "PeckList.Client.Tests", "Completion", $"pecklist.{(shell == "powershell" ? "ps1" : shell)}");

    [Theory]
    [MemberData(nameof(Shells))]
    public void The_completion_scripts_are_the_table(string shell) => Matches(SnapshotFile(shell), Script(shell));

    private static bool Installed(string program) =>
        (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)
            .Any(folder => File.Exists(Path.Combine(folder, program)) || File.Exists(Path.Combine(folder, program + ".exe")));

    /// <summary>
    /// Names from the server go into a PowerShell line as one literal argument, whatever quotes they
    /// hold: PowerShell also ends '...' at U+2018 to U+201B, so a list named
    /// <c>Groceries’; Write-Output RAN #</c> once ran as code on Enter (security review, PL-138).
    /// Real pwsh (the dotnet SDK image has it), with a stand-in pecklist that prints the names.
    /// </summary>
    [Fact]
    public async Task PowerShell_inserts_hostile_names_as_one_literal_argument()
    {
        Assert.SkipUnless(Installed("pwsh") && !OperatingSystem.IsWindows(), "pwsh on Linux or macOS is not installed here");
        string[] names =
        [
            "Groceries’; Write-Output INJECTED-RAN #", "‘open", "b‚c", "‛d", "#urgent", "it's", "Veg garden", "$(Write-Output RAN)", "plain-name",
        ];
        var folder = Path.Combine(Path.GetTempPath(), $"pecklist-ps-{Guid.NewGuid():N}");
        Directory.CreateDirectory(folder);
        try
        {
            var fake = Path.Combine(folder, "pecklist");
            await File.WriteAllTextAsync(fake, "#!/bin/sh\ncat \"$(dirname \"$0\")/names.txt\"\n", Cli.Token);
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(fake, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            await File.WriteAllTextAsync(Path.Combine(folder, "names.txt"), string.Join('\n', names) + "\n", Cli.Token);
            await File.WriteAllTextAsync(Path.Combine(folder, "pecklist.ps1"), Completion.PowerShell(), Cli.Token);
            await File.WriteAllTextAsync(Path.Combine(folder, "check.ps1"), """
                [Console]::OutputEncoding = [Text.Encoding]::UTF8
                . (Join-Path $PSScriptRoot 'pecklist.ps1')
                $line = 'pecklist tasks add -l '
                $found = (TabExpansion2 -inputScript $line -cursorColumn $line.Length).CompletionMatches
                $out = foreach ($match in $found) {
                    $tokens = $null; $errors = $null
                    $ast = [System.Management.Automation.Language.Parser]::ParseInput($line + $match.CompletionText + ' milk', [ref]$tokens, [ref]$errors)
                    $value = $ast.EndBlock.Statements[0].PipelineElements[0].CommandElements[4]
                    [pscustomobject]@{
                        name = $match.ListItemText
                        statements = $ast.EndBlock.Statements.Count
                        errors = $errors.Count
                        value = if ($value -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $value.Value } else { "not literal: " + $value.Extent.Text }
                        last = $ast.EndBlock.Statements[0].PipelineElements[0].CommandElements[-1].Extent.Text
                    }
                }
                ConvertTo-Json -InputObject @($out) -Compress
                """, Cli.Token);
            var start = new ProcessStartInfo("pwsh") { RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = System.Text.Encoding.UTF8 };
            start.ArgumentList.Add("-NoProfile");
            start.ArgumentList.Add("-File");
            start.ArgumentList.Add(Path.Combine(folder, "check.ps1"));
            start.Environment["PATH"] = folder + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
            using var process = Process.Start(start)!;
            var output = await process.StandardOutput.ReadToEndAsync(Cli.Token);
            var errors = await process.StandardError.ReadToEndAsync(Cli.Token);
            await process.WaitForExitAsync(Cli.Token);
            Assert.True(process.ExitCode == 0, errors);
            var results = System.Text.Json.Nodes.JsonNode.Parse(output)!.AsArray();
            Assert.Equal(names.Order(StringComparer.Ordinal), results.Select(each => (string)each!["name"]!).Order(StringComparer.Ordinal));
            foreach (var each in results)
            {
                var name = (string)each!["name"]!;
                Assert.True((int)each["statements"]! == 1 && (int)each["errors"]! == 0, $"{name}: {each.ToJsonString()}");
                Assert.Equal(name, (string?)each["value"]);
                Assert.Equal("milk", (string?)each["last"]);
            }
        }
        finally
        {
            Directory.Delete(folder, recursive: true);
        }
    }

    /// <summary>
    /// The shell itself accepts the script (bash -n, zsh -n, fish -n), where that shell is
    /// installed. CI's image has bash; the others are checked where they are found (and by the
    /// developer, see the PL-138 notes).
    /// </summary>
    [Theory]
    [MemberData(nameof(Shells))]
    public async Task The_shell_reads_the_completion_script(string shell)
    {
        var program = shell == "powershell" ? "pwsh" : shell;
        var found = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)
            .Any(folder => File.Exists(Path.Combine(folder, program)) || File.Exists(Path.Combine(folder, program + ".exe")));
        Assert.SkipUnless(found, $"{program} is not installed here");
        var file = Path.Combine(Path.GetTempPath(), $"pecklist-completion-{Guid.NewGuid():N}.{shell}");
        await File.WriteAllTextAsync(file, Script(shell), Cli.Token);
        try
        {
            var start = new ProcessStartInfo(program) { RedirectStandardError = true, RedirectStandardOutput = true };
            if (shell == "powershell")
            {
                start.ArgumentList.Add("-NoProfile");
                start.ArgumentList.Add("-Command");
                start.ArgumentList.Add($"$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('{file}', [ref]$null, [ref]$e); if ($e) {{ $e; exit 1 }}");
            }
            else
            {
                start.ArgumentList.Add("-n");
                start.ArgumentList.Add(file);
            }
            using var process = Process.Start(start)!;
            var errors = await process.StandardError.ReadToEndAsync(Cli.Token) + await process.StandardOutput.ReadToEndAsync(Cli.Token);
            await process.WaitForExitAsync(Cli.Token);
            Assert.True(process.ExitCode == 0, $"{program} -n: {errors}");
        }
        finally
        {
            File.Delete(file);
        }
    }
}
