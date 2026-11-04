using System.Net;

namespace PeckList.Core.Mail;

/// <summary>
/// The emails the server sends (PL-122): short, plain text with the same as simple HTML, the
/// server's name in the subject, no tracking pixels and no rewritten links.
/// </summary>
public static class MailTemplates
{
    /// <summary>A password reset link, asked for on the sign-in page or sent by an admin.</summary>
    public static OutgoingMail Reset(string to, string server, string username, string link, TimeSpan lifetime) => Build(
        to,
        $"Reset your PeckList password on {server}",
        [
            $"Someone asked to reset the password of {username} on {server}.",
            $"This link sets a new one. It works once, for {Minutes(lifetime)}:",
        ],
        link,
        "If it was not you, ignore this email: your password stays as it is.");

    /// <summary>Confirms an email someone gave their account.</summary>
    public static OutgoingMail Confirm(string to, string server, string username, string link) => Build(
        to,
        $"Confirm your email for PeckList on {server}",
        [$"Confirm this email for {username} on {server}, so password reset links can come here:"],
        link,
        "If you did not add this email to a PeckList account, ignore this email.");

    /// <summary>An invite link an admin sends to someone.</summary>
    public static OutgoingMail Invite(string to, string server, string from, string link, DateTimeOffset expires) => Build(
        to,
        $"You're invited to PeckList on {server}",
        [$"{from} invited you to PeckList on {server}, a place to keep and share tasks.",
            $"Make your account with this link (until {expires:MMMM d, yyyy}):"],
        link,
        "If you were not expecting this, ignore this email.");

    private static string Minutes(TimeSpan lifetime) =>
        lifetime.TotalMinutes is var minutes && minutes < 120 ? $"{minutes:0} minutes" : $"{lifetime.TotalHours:0} hours";

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
