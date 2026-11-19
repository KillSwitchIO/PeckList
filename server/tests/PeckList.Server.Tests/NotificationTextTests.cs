using PeckList.Core.Notifications;

namespace PeckList.Server.Tests;

public class NotificationTextTests
{
    private static Notification Of(string kind, string? commentId = null) => new()
    {
        Id = "N1",
        UserId = "U1",
        Kind = kind,
        At = DateTimeOffset.UnixEpoch,
        TaskId = "T1",
        CommentId = commentId,
    };

    [Fact]
    public void A_comment_offers_Reply_then_a_thumbs_up_and_a_group_task_Open_then_Call_dibs()
    {
        var comment = NotificationText.ActionsOf(Of(NotificationKind.Commented, "C1"), "/today?task=T1&comment=C1");
        // The thumbs up and the dibs name their task; the address only opens it (no like=1 or
        // dibs=1, which the app no longer takes from an address: security review 2026-11-19).
        Assert.Equal(
            [("reply", "/today?task=T1&comment=C1", (string?)null), ("like", "/today?task=T1&comment=C1", "T1")],
            comment.Select(each => (each.Action, each.Url, each.TaskId)));

        var group = NotificationText.ActionsOf(Of(NotificationKind.GroupAssigned), "/today?task=T1");
        Assert.Equal(["Open task", "Call dibs"], group.Select(each => each.Title));
        Assert.Equal(("dibs", "/today?task=T1", "T1"), (group[1].Action, group[1].Url, group[1].TaskId));
        Assert.Null(group[0].TaskId);

        Assert.Equal([("open", "Open task", "/today?task=T1")],
            NotificationText.ActionsOf(Of(NotificationKind.Assigned), "/today?task=T1").Select(each => (each.Action, each.Title, each.Url)));
        Assert.Equal(["Open task"], NotificationText.ActionsOf(Of(NotificationKind.Claimed), "/today?task=T1").Select(each => each.Title));
        Assert.Equal([("open", "Open list", "/lists/L1")],
            NotificationText.ActionsOf(Of(NotificationKind.Shared), "/lists/L1").Select(each => (each.Action, each.Title, each.Url)));
        Assert.Empty(NotificationText.ActionsOf(Of(NotificationKind.Reminder), "/today?task=T1"));
    }
}
