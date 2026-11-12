using System.Text;

namespace PeckList.Client;

/// <summary>
/// The docs' client command reference (PL-138): the end of <c>docs/reference/cli.md</c>, from its
/// <see cref="Heading"/> on, made from <see cref="CommandTable"/>. A test fails when the page and
/// the table differ, and rewrites the page when asked (see the test for how).
/// </summary>
internal static class CommandDocs
{
    public const string Heading = "## Client command reference";

    public static string Render()
    {
        var s = new StringBuilder();
        s.Append(Heading).Append("\n\n");
        s.Append("Made from the CLI's own command table, the one `pecklist help <command>` prints from, so the two\n");
        s.Append("always agree. Every command also takes `-h`, `--help` (show its help and run nothing), `--server URL`,\n");
        s.Append("`--profile NAME`, `--api-key KEY` and `--insecure-http`: see\n");
        s.Append("[which key a command uses](#which-key-a-command-uses). `pecklist -v` or `pecklist --version` prints the\n");
        s.Append("version. Exit codes: ").Append(Help.ExitCodes).Append('\n');
        foreach (var command in CommandTable.Commands.Where(each => !each.Hidden && each.Path.Length > 0 && !each.Remote))
        {
            s.Append("\n### `").Append(command.Path).Append("`\n\n");
            s.Append(Prose(command.Summary)).Append("\n\n");
            s.Append("```text\n").Append(Help.UsageLine(command)).Append('\n');
            foreach (var alias in command.Aliases) s.Append(Help.UsageLine(command).Replace($"pecklist {command.Path}", $"pecklist {alias}")).Append('\n');
            s.Append("```\n");
            if (command.Details is { } details) s.Append('\n').Append(Prose(details)).Append('\n');
            if (CommandTable.IsGroup(command))
            {
                s.Append("\n| Command | What it does |\n| --- | --- |\n");
                foreach (var child in CommandTable.Children(command))
                {
                    var aliases = child.Aliases.Length == 0 ? "" : " (" + string.Join(", ", child.Aliases.Select(alias => $"`{alias}`")) + ")";
                    s.Append($"| [`{child.Path}`](#{child.Anchor}){aliases} | {Cell(Prose(child.Summary))} |\n");
                }
            }
            else if (command.Options.Length > 0 || command.Arguments.Any(argument => argument.Choices is not null))
            {
                s.Append('\n');
                if (command.Options.Length > 0)
                {
                    s.Append("| Option | What it does |\n| --- | --- |\n");
                    foreach (var use in command.Options)
                    {
                        var option = CommandTable.Option(use.Long)!;
                        var names = (option.Short is { } letter ? $"`-{letter}`, " : "") + $"`{option.Long}{(option.Value is null ? "" : $" {option.Value}")}`";
                        var help = use.Help ?? option.Help;
                        if (option.Choices is { } choices && !help.Contains(choices[0], StringComparison.Ordinal)) help += $" One of: {string.Join(", ", choices)}.";
                        s.Append($"| {Cell(names)} | {Cell(Prose(help))} |\n");
                    }
                }
                foreach (var argument in command.Arguments.Where(argument => argument.Choices is not null))
                {
                    if (command.Options.Length > 0) s.Append('\n');
                    s.Append($"`{argument.Name}` is one of: {string.Join(", ", argument.Choices!.Select(choice => $"`{choice}`"))}.\n");
                }
            }
            s.Append("\n```bash\n");
            foreach (var example in command.Examples) s.Append(example).Append('\n');
            s.Append("```\n");
        }
        // The remote admin commands are described with the server's; here, how the client calls them.
        s.Append("\n### Remote admin command options\n\n");
        s.Append("These run through the admin API (see [remote admin commands](#remote-admin-commands)); each\n");
        s.Append("links to its description with the server's commands.\n\n");
        s.Append("| Command | Usage | Options |\n| --- | --- | --- |\n");
        foreach (var command in CommandTable.Commands.Where(each => !each.Hidden && each.Remote && !CommandTable.IsGroup(each)))
        {
            var options = string.Join("; ", command.Options.Select(use => (Option: CommandTable.Option(use.Long)!, Help: use.Help))
                .Select(each => $"`{each.Option.Long}{(each.Option.Value is null ? "" : $" {each.Option.Value}")}`: {Prose((each.Help ?? each.Option.Help).TrimEnd('.'))}"));
            s.Append($"| [`{command.Path}`](#{command.Anchor}) | {Cell($"`{Help.UsageLine(command)}`")} | {Cell(options)} |\n");
        }
        return s.ToString();
    }

    /// <summary>
    /// Text as MDX takes it: braces and angle brackets outside code spans would be read as JSX, so
    /// they are escaped; code spans stay as they are.
    /// </summary>
    internal static string Prose(string text)
    {
        var s = new StringBuilder();
        var code = false;
        foreach (var c in text)
        {
            if (c == '`') code = !code;
            if (!code && c is '{' or '}') s.Append('\\');
            if (!code && c == '<') s.Append("&lt;");
            else if (!code && c == '>') s.Append("&gt;");
            else s.Append(c);
        }
        return s.ToString();
    }

    /// <summary>A table cell: a pipe would end it, even inside a code span.</summary>
    private static string Cell(string text) => text.Replace("|", "\\|");
}
