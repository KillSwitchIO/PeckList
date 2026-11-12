using System.Text.Json.Nodes;

namespace PeckList.Client.Tests;

/// <summary>The command line as people type it (PL-138): help, short options, aliases, standard input, usage errors.</summary>
public sealed class ClientCliTests
{
    private const string Server = "https://tasks.example.com";

    private static async Task<MemoryTokenStore> SignedInAsync()
    {
        var store = new MemoryTokenStore();
        await store.SaveAsync("default", new CliProfile(Server, "pl_test_key", "K1", "ben"), Cli.Token);
        return store;
    }

    private static FakeApi Api() => new()
    {
        Answers =
        {
            ["api/v1/lists?archived=true"] = """{"items":[{"id":"L1","name":"Yard"},{"id":"L2","name":"Home"}]}""",
            ["api/v1/lists"] = """{"items":[{"id":"L1","name":"Yard"},{"id":"L2","name":"Home"}]}""",
            ["api/v1/tags"] = """{"items":[{"name":"home"},{"name":"errands"}]}""",
            ["POST api/v1/tasks/quick"] = """{"task":{"id":"T9","title":"Buy milk"},"tokens":[]}""",
            ["DELETE api/v1/tasks/T9"] = "",
        },
    };

    // Help ----------------------------------------------------------------------------------------

    public static TheoryData<string[]> HelpLines()
    {
        var lines = new TheoryData<string[]>();
        foreach (var command in CommandTable.Commands.Where(each => !each.Hidden))
        {
            // Arguments as a real call would have them, so the help comes before a command that would run.
            var call = command.Words.Concat(command.Arguments.Where(argument => argument.Required).Select(argument => argument.Choices?[0] ?? "X1")).ToArray();
            lines.Add([.. call, "--help"]);
            lines.Add([.. call, "-h"]);
            lines.Add(["help", .. command.Words]);
            lines.Add([.. command.Words.Take(1), "-h", .. call.Skip(1)]);
        }
        lines.Add(["tasks", "delete", "SOMEID", "--help"]);
        lines.Add(["tasks", "rm", "SOMEID", "-jh"]);
        lines.Add(["tasks", "edit", "SOMEID", "--title", "New", "--help"]);
        lines.Add(["login", "--server", Server, "--token", "--help"]);
        lines.Add(["tasks", "help", "add"]);
        return lines;
    }

    [Theory]
    [MemberData(nameof(HelpLines))]
    public async Task Help_anywhere_on_the_line_shows_help_and_runs_nothing(string[] line)
    {
        var api = new FakeApi { Forbidden = true };
        var store = new UntouchableStore();
        var ran = await Cli.RunAsync(api, store, line);
        Assert.True(ran.Code == ClientCli.Done, $"{string.Join(' ', line)}: {ran.Err}");
        Assert.Contains("usage: pecklist", ran.Out);
        Assert.Empty(ran.Err);
        Assert.Empty(api.Requests);
        Assert.Equal(0, store.Touched);
    }

    [Fact]
    public async Task Each_level_of_help_is_its_own()
    {
        var api = new FakeApi { Forbidden = true };
        var store = new UntouchableStore();
        var bare = await Cli.RunAsync(api, store);
        Assert.Contains("Run `pecklist help <command>`", bare.Out);
        Assert.DoesNotContain("tasks list", bare.Out);
        var full = await Cli.RunAsync(api, store, "help");
        Assert.Equal(full.Out, (await Cli.RunAsync(api, store, "-h")).Out);
        Assert.Equal(full.Out, (await Cli.RunAsync(api, store, "--help")).Out);
        Assert.Contains("tasks list (ls)", full.Out);
        Assert.Contains("tasks add TEXT... (pecklist add)", full.Out);
        var group = await Cli.RunAsync(api, store, "tasks");
        Assert.Equal(group.Out, (await Cli.RunAsync(api, store, "tasks", "-h")).Out);
        Assert.Equal(group.Out, (await Cli.RunAsync(api, store, "help", "tasks")).Out);
        Assert.Contains("usage: pecklist tasks <command> [options]", group.Out);
        Assert.Contains("list (ls)", group.Out);
        var add = await Cli.RunAsync(api, store, "tasks", "add", "--help");
        Assert.Equal(add.Out, (await Cli.RunAsync(api, store, "help", "tasks", "add")).Out);
        Assert.Equal(add.Out, (await Cli.RunAsync(api, store, "help", "add")).Out);
        Assert.Contains("-q, --quiet", add.Out);
        Assert.Contains("-l, --list L", add.Out);
        Assert.Contains("--server URL", add.Out);
        Assert.Contains("Exit codes: 0 done", add.Out);
        Assert.Contains("Docs: https://docs.pecklist.com/reference/cli#tasks-add", add.Out);
    }

    [Fact]
    public async Task Mistakes_say_how_to_call_it_and_never_guess_a_command_to_run()
    {
        var api = new FakeApi { Forbidden = true };
        var store = new UntouchableStore();
        var typo = await Cli.RunAsync(api, store, "taks", "list");
        Assert.Equal(ClientCli.BadUsage, typo.Code);
        Assert.Contains("did you mean `tasks`?", typo.Err);
        var subTypo = await Cli.RunAsync(api, store, "tasks", "lsit");
        Assert.Contains("did you mean `tasks list`?", subTypo.Err);
        Assert.Contains("one of: list, add", (await Cli.RunAsync(api, store, "tasks", "fly")).Err);
        var missing = await Cli.RunAsync(api, store, "tasks", "done");
        Assert.Equal(ClientCli.BadUsage, missing.Code);
        Assert.Contains("usage: pecklist tasks done ID [--wontdo] [-j]", missing.Err);
        var stray = await Cli.RunAsync(api, store, "tasks", "done", "X", "--list", "Yard");
        Assert.Equal(ClientCli.BadUsage, stray.Code);
        Assert.Contains("tasks done does not take --list", stray.Err);
        Assert.Equal(ClientCli.BadUsage, (await Cli.RunAsync(api, store, "tasks", "done", "X", "Y")).Code);
        Assert.Equal(ClientCli.BadUsage, (await Cli.RunAsync(api, store, "tasks", "list", "-x")).Code);
        Assert.Equal(ClientCli.BadUsage, (await Cli.RunAsync(api, store, "tasks", "list", "-l")).Code);
        Assert.Equal(ClientCli.BadUsage, (await Cli.RunAsync(api, store, "tasks", "-v")).Code);
        Assert.Equal(ClientCli.BadUsage, (await Cli.RunAsync(api, store, "completion", "tcsh")).Code);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Version_answers_to_v_and_version_alike()
    {
        var api = new FakeApi { Forbidden = true };
        var store = new UntouchableStore();
        var line = (await Cli.RunAsync(api, store, "--version")).Out;
        Assert.StartsWith("pecklist ", line);
        Assert.Equal(line, (await Cli.RunAsync(api, store, "-v")).Out);
        Assert.Equal(line, (await Cli.RunAsync(api, store, "version")).Out);
    }

    // Parsing -------------------------------------------------------------------------------------

    [Fact]
    public void Letters_group_and_take_values_joined_or_apart()
    {
        var parsed = ClientArgs.Parse(["tasks", "list", "-aj", "-lYard", "-t", "home", "--section=Beds", "--status", "done"]);
        Assert.Equal(["tasks", "list"], parsed.Words);
        Assert.True(parsed.Flag("--all") && parsed.Flag("--json"));
        Assert.Equal("Yard", parsed.Value("--list"));
        Assert.Equal("home", parsed.Value("--tag"));
        Assert.Equal("Beds", parsed.Value("--section"));
        Assert.Equal("done", parsed.Value("--status"));
        var grouped = ClientArgs.Parse(["tasks", "list", "-al", "Yard"]);
        Assert.True(grouped.Flag("--all"));
        Assert.Equal("Yard", grouped.Value("--list"));
        var rest = ClientArgs.Parse(["add", "-q", "--", "-5 degrees", "-l"]);
        Assert.Equal(["add", "-5 degrees", "-l"], rest.Words);
        Assert.Equal(["add", "-"], ClientArgs.Parse(["add", "-"]).Words);
        Assert.Equal("Water", ClientArgs.Parse(["tasks", "edit", "X", "-TWater"]).Value("--title"));
    }

    [Fact]
    public void Help_is_seen_before_the_end_of_options_only()
    {
        Assert.True(ClientArgs.WantsHelp(["tasks", "delete", "X", "--help"]));
        Assert.True(ClientArgs.WantsHelp(["tasks", "list", "-ah"]));
        Assert.True(ClientArgs.WantsHelp(["tasks", "list", "--nonsense", "-h"]));
        Assert.False(ClientArgs.WantsHelp(["add", "--", "-h"]));
        Assert.False(ClientArgs.WantsHelp(["tasks", "list", "-lhome"]));
    }

    // Commands ------------------------------------------------------------------------------------

    [Fact]
    public async Task Short_options_aliases_quiet_and_standard_input()
    {
        var api = Api();
        var store = await SignedInAsync();
        var quiet = await Cli.RunAsync(api, store, "add", "Buy milk tomorrow", "-l", "Yard", "-q");
        Assert.True(quiet.Code == 0, quiet.Err);
        Assert.Equal("T9\n", quiet.Out);
        Assert.Contains("POST /api/v1/tasks/quick", api.Requests);

        var piped = await Cli.RunAsync(api, store, "Buy milk #home\n", new Dictionary<string, string>(), "tasks", "add", "-", "-lYard");
        Assert.True(piped.Code == 0, piped.Err);
        Assert.Contains("Added: Buy milk", piped.Out);
        var twoLines = await Cli.RunAsync(api, store, "one\ntwo\n", new Dictionary<string, string>(), "tasks", "add", "-");
        Assert.Equal(ClientCli.BadUsage, twoLines.Code);
        Assert.Equal(ClientCli.BadUsage, (await Cli.RunAsync(api, store, "tasks", "add", "-")).Code);

        Assert.Contains("Deleted.", (await Cli.RunAsync(api, store, "tasks", "rm", "T9")).Out);
        Assert.Contains("DELETE /api/v1/tasks/T9", api.Requests);
    }

    [Fact]
    public async Task Adding_with_no_inbox_says_to_name_a_list()
    {
        var api = Api();
        api.Answers.Remove("POST api/v1/tasks/quick");
        var handler = new NoInbox(api);
        var ran = await Cli.RunAsync(handler, await SignedInAsync(), "tasks", "add", "Buy milk");
        Assert.Equal(ClientCli.Failed, ran.Code);
        Assert.Contains("you have no inbox yet", ran.Err);
        Assert.Contains("-l/--list", ran.Err);
    }

    [Fact]
    public void A_read_only_key_is_told_it_lacks_tasks_write_and_an_admin_command_to_sign_in_with_admin()
    {
        var write = ClientCli.ScopeHint(new ApiProblem(403, "scope", "this key lacks the tasks:write permission"));
        Assert.Contains("tasks:write", write);
        Assert.DoesNotContain("--admin", write);
        Assert.Contains("login --admin", ClientCli.ScopeHint(new ApiProblem(403, "scope", "this key lacks the admin permission")));
        Assert.Equal("", ClientCli.ScopeHint(new ApiProblem(403, "forbidden", "not yours")));
    }

    private sealed class NoInbox(FakeApi inner) : DelegatingHandler(inner)
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            request.RequestUri!.AbsolutePath.EndsWith("/tasks/quick", StringComparison.Ordinal)
                ? Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.BadRequest)
                {
                    Content = new StringContent("""{"code":"validation","detail":"invalid","errors":{"listId":["is required: you have no inbox yet"]}}"""),
                })
                : base.SendAsync(request, cancellationToken);
    }

    [Fact]
    public async Task Completion_prints_each_script_and_the_json_of_a_list_is_items()
    {
        var api = new FakeApi { Forbidden = true };
        var store = new UntouchableStore();
        foreach (var shell in CommandTable.Shells)
        {
            var ran = await Cli.RunAsync(api, store, "completion", shell);
            Assert.True(ran.Code == 0, ran.Err);
            Assert.Contains("pecklist __complete", ran.Out);
        }
        var listed = await Cli.RunAsync(Api(), await SignedInAsync(), "lists", "list", "-j");
        Assert.Equal(2, JsonNode.Parse(listed.Out)!["items"]!.AsArray().Count);
    }
}
