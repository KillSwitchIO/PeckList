using System.Net;
using PeckList.Core.Push;
using PeckList.Core.Text;

namespace PeckList.Core.Mail;

/// <summary>
/// The emails the server sends (PL-122): short, plain text with the same as simple HTML, the
/// server's name in the subject, no tracking pixels and no rewritten links. In <c>words</c>'
/// language (PL-148), English when not given.
/// </summary>
public static class MailTemplates
{
    /// <summary>A password reset link, asked for on the sign-in page or sent by an admin.</summary>
    public static OutgoingMail Reset(string to, string server, string username, string link, TimeSpan lifetime, Words? words = null)
    {
        words ??= Words.English;
        return Build(
            to,
            words.Get("mail.reset.subject", ("server", server)),
            [
                words.Get("mail.reset.asked", ("username", username), ("server", server)),
                words.Get("mail.reset.link", ("lifetime", Lifetime(lifetime, words))),
            ],
            link,
            words["mail.reset.notYou"]);
    }

    /// <summary>Confirms an email someone gave their account.</summary>
    public static OutgoingMail Confirm(string to, string server, string username, string link, Words? words = null)
    {
        words ??= Words.English;
        return Build(
            to,
            words.Get("mail.confirm.subject", ("server", server)),
            [words.Get("mail.confirm.lead", ("username", username), ("server", server))],
            link,
            words["mail.confirm.notYou"]);
    }

    /// <summary>An invite link an admin sends to someone.</summary>
    public static OutgoingMail Invite(string to, string server, string from, string link, DateTimeOffset expires, Words? words = null)
    {
        words ??= Words.English;
        var until = DatePattern.Format(DateOnly.FromDateTime(expires.DateTime), words["mail.invite.datePattern"], words);
        return Build(
            to,
            words.Get("mail.invite.subject", ("server", server)),
            [words.Get("mail.invite.lead", ("from", from), ("server", server)), words.Get("mail.invite.link", ("date", until))],
            link,
            words["mail.invite.notExpected"]);
    }

    /// <summary>The admin's test email (Admin &gt; Email), plain text only.</summary>
    public static OutgoingMail Test(string to, string server, Words? words = null)
    {
        words ??= Words.English;
        return new OutgoingMail(to, words.Get("mail.test.subject", ("server", server)), words.Get("mail.test.body", ("server", server)) + Environment.NewLine);
    }

    private static string Lifetime(TimeSpan lifetime, Words words) =>
        lifetime.TotalMinutes < 120
            ? words.Get("mail.reset.minutes", ("count", (int)Math.Round(lifetime.TotalMinutes)))
            : words.Get("mail.reset.hours", ("count", (int)Math.Round(lifetime.TotalHours)));

    private static OutgoingMail Build(string to, string subject, IReadOnlyList<string> lead, string link, string closing)
    {
        var text = string.Join(Environment.NewLine + Environment.NewLine, [.. lead, link, closing]) + Environment.NewLine;
        var paragraphs = string.Concat(lead.Select(line => $"<p>{WebUtility.HtmlEncode(line)}</p>"));
        var html = $"""
            <!doctype html>
            <html><body style="font-family: system-ui, sans-serif; font-size: 15px; line-height: 1.5; color: #1f1f1f;">
            {paragraphs}
            <p><a href="{WebUtility.HtmlEncode(link)}">{WebUtility.HtmlEncode(link)}</a></p>
            <p style="color: #5f6368;">{WebUtility.HtmlEncode(closing)}</p>
            </body></html>
            """;
        return new OutgoingMail(to, subject, text, html);
    }
}
