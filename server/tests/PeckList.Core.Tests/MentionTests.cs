using System.Text.Json.Nodes;
using PeckList.Core.Notifications;

namespace PeckList.Core.Tests;

/// <summary>The server reads @mentions as the web app does (audit D3): the cases both sides test.</summary>
public sealed class MentionTests
{
    public static TheoryData<string, string[]> Cases()
    {
        var data = new TheoryData<string, string[]>();
        var file = JsonNode.Parse(File.ReadAllText(RepoFiles.Path("schema", "fixtures", "mentions", "cases.json")))!;
        foreach (var each in file["cases"]!.AsArray())
        {
            data.Add((string)each!["body"]!, [.. each["names"]!.AsArray().Select(name => (string)name!)]);
        }
        return data;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void A_body_names_who_the_web_app_shows_as_mentioned(string body, string[] names) =>
        Assert.Equal(names, NotificationRules.MentionedNames(body));
}
