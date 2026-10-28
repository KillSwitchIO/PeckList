using Punchlist.Core.Notifications;

namespace Punchlist.Server.Tests;

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
        Assert.Equal(
            [("reply", "/today?task=T1&comment=C1"), ("like", "/today?task=T1&comment=C1&like=1")],
            comment.Select(each => (each.Action, each.Url)));

        var group = NotificationText.ActionsOf(Of(NotificationKind.GroupAssigned), "/today?task=T1");
        Assert.Equal(["Open task", "Call dibs"], group.Select(each => each.Title));
        Assert.Equal("/today?task=T1&dibs=1", group[1].Url);

        Assert.Empty(NotificationText.ActionsOf(Of(NotificationKind.Assigned), "/today?task=T1"));
    }
}
