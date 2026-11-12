using System.Text;

namespace PeckList.Client;

/// <summary>The help texts (PL-138), all made from <see cref="CommandTable"/>.</summary>
internal static class Help
{
    public const string ExitCodes = "0 done, 1 failed, 2 bad usage, 3 not signed in, 4 not allowed.";

    private const int Column = 30;

    /// <summary><c>pecklist tasks done ID [--wontdo]</c>: the arguments, and the command's own options when they are few.</summary>
    public static string UsageLine(CliCommand command)
    {
        var line = new StringBuilder("pecklist");
        if (command.Path.Length > 0) line.Append(' ').Append(command.Path);
        if (CommandTable.IsGroup(command))
        {
            return line.Append(" <command> [options]").ToString();
        }
        foreach (var argument in command.Arguments) line.Append(' ').Append(argument.Display);
        var own = command.Options.Select(use => CommandTable.Option(use.Long)!).ToList();
        if (own.Count is > 0 and <= 3)
        {
            foreach (var option in own)
            {
                var name = option.Short is { } letter ? $"-{letter}" : option.Long;
                line.Append(" [").Append(name).Append(option.Value is null ? "" : $" {option.Value}").Append(']');
            }
        }
        else if (own.Count > 3)
        {
            line.Append(" [options]");
        }
        return line.ToString();
    }

    /// <summary>The name with its aliases, as lists show it: <c>tasks list (ls)</c>, <c>tasks add (pecklist add)</c>.</summary>
    public static string Named(CliCommand command, string name = "") =>
        (name.Length > 0 ? name : command.Path) + string.Concat(command.Arguments.Select(argument => " " + argument.Display))
        + (command.Aliases.Length == 0
            ? ""
            : $" ({string.Join(", ", command.Aliases.Select(alias => CommandTable.Parent(alias) == CommandTable.Parent(command.Path) ? alias.Split(' ')[^1] : $"pecklist {alias}"))})");

    private static void Row(StringBuilder text, string left, string right)
    {
        text.Append("  ").Append(left);
        if (left.Length + 2 < Column) text.Append(' ', Column - left.Length - 2);
        else text.Append('\n').Append(' ', Column);
        text.Append(right).Append('\n');
    }

    /// <summary>What a bare <c>pecklist</c> prints: the commands, and where to look next.</summary>
    public static string Short()
    {
        var text = new StringBuilder();
        text.Append("usage: pecklist <command> [options]\n\n");
        text.Append(CommandTable.Root.Summary).Append("\n\nCommands:\n");
        foreach (var command in CommandTable.Children(CommandTable.Root)) Row(text, command.Path, command.Summary);
        text.Append("\nRun `pecklist help <command>` for details, or `pecklist help` for everything.\n");
        return text.ToString();
    }

    /// <summary>What <c>pecklist help</c>, <c>-h</c> and <c>--help</c> print: every command, the options and the rules.</summary>
    public static string Full()
    {
        var text = new StringBuilder();
        text.Append("Client commands (any machine, through the server's API):\n\n");
        text.Append("usage: pecklist <command> [options]\n\n");
        foreach (var command in CommandTable.Commands.Where(each => !each.Hidden && each.Path.Length > 0 && !CommandTable.IsGroup(each)))
        {
            Row(text, Named(command), command.Summary);
        }
        text.Append("\nOptions for every command:\n");
        foreach (var name in CommandTable.Global.Prepend("--version"))
        {
            var option = CommandTable.Option(name)!;
            Row(text, option.Display, option.Help + (name == "--version" ? " (on its own)" : ""));
        }
        text.Append("\nEach command's own options: pecklist help <command>, or pecklist <command> -h.\n");
        text.Append("In the server program, admin, oidc, snapshot, export and config show run on its own database\n");
        text.Append("unless --server or --profile names a server; in the client download they always go to a server.\n");
        text.Append("\nEnvironment: PECKLIST_SERVER, PECKLIST_PROFILE, PECKLIST_TOKEN (a key).\n");
        text.Append("The key used: --api-key, then PECKLIST_TOKEN, then the saved sign-in.\n");
        text.Append("L is a list id or name (exact, then a unique start, as ^list matches). DATE is 2026-11-30 or\n");
        text.Append("2026-11-30T09:00.\n");
        text.Append("Exit codes: ").Append(ExitCodes).Append('\n');
        text.Append("Docs: ").Append(CommandTable.DocsUrl).Append('\n');
        return text.ToString();
    }

    /// <summary>One command's help, or a group's: what it does, how to call it, its options, examples, exit codes, docs.</summary>
    public static string For(CliCommand command)
    {
        if (command.Path.Length == 0) return Full();
        var text = new StringBuilder();
        text.Append("pecklist ").Append(command.Path).Append(" - ").Append(command.Summary).Append("\n\n");
        text.Append("usage: ").Append(UsageLine(command)).Append('\n');
        if (command.Aliases.Length > 0) text.Append("   or: ").Append(string.Join(", ", command.Aliases.Select(alias => $"pecklist {alias}"))).Append('\n');
        if (command.Details is { } details) text.Append('\n').Append(Wrap(details, 96)).Append('\n');
        if (CommandTable.IsGroup(command))
        {
            text.Append("\nCommands:\n");
            foreach (var child in CommandTable.Children(command))
            {
                Row(text, Named(child, child.Words[^1]), child.Summary);
            }
            text.Append($"\nRun `pecklist help {command.Path} <command>` for a command's options.\n");
        }
        else
        {
            text.Append("\nOptions:\n");
            foreach (var (option, help) in CommandTable.OptionsOf(command))
            {
                var choices = option.Choices is { } values && !help.Contains(values[0], StringComparison.Ordinal) ? $" ({string.Join(", ", values)})" : "";
                Row(text, option.Display, help + choices);
            }
            foreach (var argument in command.Arguments.Where(argument => argument.Choices is not null))
            {
                text.Append($"\n{argument.Name} is one of: {string.Join(", ", argument.Choices!)}.\n");
            }
        }
        text.Append("\nExamples:\n");
        foreach (var example in command.Examples) text.Append("  ").Append(example).Append('\n');
        text.Append("\nExit codes: ").Append(ExitCodes).Append('\n');
        text.Append("Docs: ").Append(CommandTable.DocsUrl).Append('#').Append(command.Anchor).Append('\n');
        return text.ToString();
    }

    public static string Wrap(string text, int width)
    {
        var lines = new StringBuilder();
        var line = new StringBuilder();
        foreach (var word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (line.Length > 0 && line.Length + 1 + word.Length > width)
            {
                lines.Append(line).Append('\n');
                line.Clear();
            }
            if (line.Length > 0) line.Append(' ');
            line.Append(word);
        }
        return lines.Append(line).ToString();
    }
}
