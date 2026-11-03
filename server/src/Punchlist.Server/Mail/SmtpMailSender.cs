using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using Punchlist.Core.Configuration;
using Punchlist.Core.Mail;

namespace Punchlist.Server.Mail;

/// <summary>Email through an SMTP server (PL-122), with MailKit: STARTTLS, TLS or neither, a login if set.</summary>
public sealed class SmtpMailSender(LiveSettings live, ILogger<SmtpMailSender> logger) : IMailSender
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);

    public bool Configured => live.Current.Mail is not null;

    public async Task SendAsync(OutgoingMail mail, CancellationToken cancellation = default)
    {
        var settings = live.Current.Mail ?? throw new MailException("Email is not set up on this server (SMTP_HOST).");
        MimeMessage message;
        try
        {
            message = new MimeMessage();
            message.From.Add(MailboxAddress.Parse(settings.From));
            message.To.Add(MailboxAddress.Parse(mail.To));
        }
        catch (ParseException error)
        {
            throw new MailException($"Not an email address: {error.Message}", error);
        }
        message.Subject = mail.Subject;
        var body = new BodyBuilder { TextBody = mail.Text };
        if (mail.Html is not null) body.HtmlBody = mail.Html;
        message.Body = body.ToMessageBody();

        using var client = new SmtpClient { Timeout = (int)Timeout.TotalMilliseconds };
        try
        {
            var security = settings.Tls switch
            {
                MailTls.Tls => SecureSocketOptions.SslOnConnect,
                MailTls.None => SecureSocketOptions.None,
                _ => SecureSocketOptions.StartTls,
            };
            await client.ConnectAsync(settings.Host, settings.Port, security, cancellation);
            if (settings.User is { Length: > 0 } user) await client.AuthenticateAsync(user, settings.Password ?? "", cancellation);
            await client.SendAsync(message, cancellation);
            await client.DisconnectAsync(true, cancellation);
            logger.LogInformation("Email sent to {To}: {Subject}", mail.To, mail.Subject);
        }
        catch (Exception error) when (error is not OperationCanceledException and not MailException)
        {
            logger.LogWarning("Email to {To} failed: {Error}", mail.To, error.Message);
            throw new MailException(error switch
            {
                AuthenticationException => $"The mail server refused the login: {error.Message}",
                SmtpCommandException command => $"The mail server said no: {command.Message}",
                SslHandshakeException => $"The TLS handshake failed (check SMTP_TLS and the port): {error.Message}",
                _ => $"Could not reach the mail server at {settings.Host}:{settings.Port}: {error.Message}",
            }, error);
        }
    }
}
