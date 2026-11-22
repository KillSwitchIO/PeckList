using System.Text.Json.Nodes;
using PeckList.Client;
using static PeckList.Server.Tests.TaskApiWorld;

namespace PeckList.Server.Tests;

/// <summary>Templates from the command line (PL-140): list them and use one by name.</summary>
public sealed partial class CliCommandTests
{
    private static JsonObject TemplateTask(string title, int? dueIn = null, params JsonObject[] subtasks) => new()
    {
        ["title"] = title, ["notes"] = "", ["priority"] = 0, ["tags"] = new JsonArray(), ["start"] = null, ["end"] = null,
        ["due"] = dueIn is { } days ? new JsonObject { ["inDays"] = days, ["time"] = null } : null,
        ["reminders"] = new JsonArray(), ["recurrence"] = null, ["constantReminder"] = false, ["subtasks"] = new JsonArray(subtasks),
    };

    private static (string, JsonObject) SavedTemplate(string id, string name, string kind, string order, JsonObject body) =>
        ("templates", Entity(id, new JsonObject { ["name"] = name, ["kind"] = kind, ["order"] = order, ["body"] = body, ["uses"] = 0 }));

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Templates_are_listed_and_used_by_name_from_the_command_line(string kind)
    {
        using var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        await PushAsync(ben, List("IN", "Inbox", inbox: true), List("L1", "Work"),
            SavedTemplate("TP1", "Weekly review", "task", "a1", TemplateTask("Weekly review", 2, TemplateTask("Clear the inbox"))),
            SavedTemplate("TP2", "Camping", "list", "a2", new JsonObject
            {
                ["name"] = "Camping", ["color"] = "#2e7d32", ["icon"] = "tent", ["tasks"] = new JsonArray(TemplateTask("Tent", 1), TemplateTask("Stove")),
            }));
        var store = new MemoryTokenStore();
        Assert.Equal(0, (await Run(world, store, await KeyTokenAsync(ben.Session, "tasks:write"), "login", "--server", Server, "--token")).Code);

        var listed = await Run(world, store, null, "templates", "list");
        Assert.True(listed.Code == 0, listed.Err);
        Assert.Matches(@"TP1\s+task\s+Weekly review\s+2 tasks\s+not used yet", listed.Out);
        Assert.Matches(@"TP2\s+list\s+Camping\s+2 tasks\s+not used yet", listed.Out);
        Assert.DoesNotContain("Weekly review", (await Run(world, store, null, "templates", "list", "--kind", "list")).Out);

        // A unique start of the name, into a list by name, with a title of its own and a day.
        var used = await Run(world, store, null, "templates", "use", "weekly", "-l", "work", "--title", "Review week 48", "--day", "2026-11-23");
        Assert.True(used.Code == 0, used.Err);
        Assert.Contains("Added: Review week 48", used.Out);
        var task = JsonNode.Parse((await Run(world, store, null, "tasks", "show", AddedId().Match(used.Out).Groups[1].Value, "-j")).Out)!;
        Assert.Equal(("L1", "2026-11-25"), ((string?)task["listId"], (string?)task["due"]!["at"]));

        // A list template makes a list, named here.
        var camping = await Run(world, store, null, "templates", "use", "Camping", "--name", "Camping in May", "--day", "2027-05-01", "-q");
        Assert.True(camping.Code == 0, camping.Err);
        var listId = camping.Out.Trim();
        var tasks = JsonNode.Parse((await Run(world, store, null, "tasks", "list", "--list", listId, "-j")).Out)!["items"]!.AsArray();
        Assert.Equal(["Stove", "Tent"], tasks.Select(each => (string)each!["title"]!).Order());
        Assert.Contains("used once", (await Run(world, store, null, "templates", "list")).Out);

        // What doesn't fit says so.
        Assert.Contains("is a list template", (await Run(world, store, null, "templates", "use", "Camping", "--title", "x")).Err);
        Assert.Contains("is a task template", (await Run(world, store, null, "templates", "use", "Weekly review", "--name", "x")).Err);
        Assert.Contains("no template matches 'garden'", (await Run(world, store, null, "templates", "use", "garden")).Err);
        Assert.Contains("--day is a date", (await Run(world, store, null, "templates", "use", "Weekly review", "--day", "soon")).Err);
    }
}
