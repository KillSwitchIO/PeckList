namespace PeckList.Core.Mail;

/// <summary>
/// What a common mail provider needs (<c>SMTP_PROVIDER</c>, PL-122): its SMTP host, port and TLS,
/// and the login name when the provider fixes one (an API key's user). Anything set explicitly
/// (<c>SMTP_HOST</c>, <c>SMTP_PORT</c>, <c>SMTP_TLS</c>, <c>SMTP_USER</c>) wins over the preset.
/// The setup steps for each are in the email guide.
/// </summary>
public sealed record MailProvider(string Name, string DisplayName, string Host, int Port, MailTls Tls, string? User = null);

public static class MailProviders
{
    public static readonly IReadOnlyList<MailProvider> All =
    [
        // Mailboxes: the address and an app password.
        new("gmail", "Gmail", "smtp.gmail.com", 587, MailTls.StartTls),
        new("google-workspace", "Google Workspace", "smtp.gmail.com", 587, MailTls.StartTls),
        new("icloud", "iCloud Mail", "smtp.mail.me.com", 587, MailTls.StartTls),
        new("yahoo", "Yahoo Mail", "smtp.mail.yahoo.com", 465, MailTls.Tls),
        new("fastmail", "Fastmail", "smtp.fastmail.com", 465, MailTls.Tls),
        new("zoho", "Zoho Mail", "smtp.zoho.com", 465, MailTls.Tls),
        new("zoho-eu", "Zoho Mail (EU)", "smtp.zoho.eu", 465, MailTls.Tls),
        new("proton", "Proton Mail", "smtp.protonmail.ch", 587, MailTls.StartTls),
        // Sending services: a domain verified with them and an SMTP key.
        new("sendgrid", "SendGrid", "smtp.sendgrid.net", 587, MailTls.StartTls, "apikey"),
        new("mailgun", "Mailgun", "smtp.mailgun.org", 587, MailTls.StartTls),
        new("mailgun-eu", "Mailgun (EU)", "smtp.eu.mailgun.org", 587, MailTls.StartTls),
        new("postmark", "Postmark", "smtp.postmarkapp.com", 587, MailTls.StartTls),
        new("brevo", "Brevo", "smtp-relay.brevo.com", 587, MailTls.StartTls),
        new("resend", "Resend", "smtp.resend.com", 465, MailTls.Tls, "resend"),
        // Its region is in the host: SMTP_HOST says which when it is not us-east-1.
        new("amazon-ses", "Amazon SES", "email-smtp.us-east-1.amazonaws.com", 587, MailTls.StartTls),
    ];

    public static IReadOnlyList<string> Names { get; } = All.Select(each => each.Name).ToList();

    public static MailProvider? Find(string? name) =>
        All.FirstOrDefault(each => string.Equals(each.Name, name?.Trim(), StringComparison.OrdinalIgnoreCase));
}
