namespace PeckList.Core.Mail;

/// <summary>How the connection to the mail server is protected (<c>SMTP_TLS</c>).</summary>
public enum MailTls
{
    /// <summary>Plain at first, then TLS by STARTTLS (port 587): the usual submission port.</summary>
    StartTls,

    /// <summary>TLS from the first byte (port 465).</summary>
    Tls,

    /// <summary>No TLS at all: only for a relay on the same host or a private network.</summary>
    None,
}

/// <summary>
/// Where the server sends email from (spec: PL-122): <c>SMTP_HOST</c> and the rest. No host, no
/// email: the features that need it stay hidden.
/// </summary>
public sealed record MailSettings(string Host, int Port, string? User, string? Password, string From, MailTls Tls)
{
    /// <summary>The settings without the password, for logs and dumps.</summary>
    public override string ToString() => $"{Host}:{Port} ({Tls}) as {User ?? "no login"}, from {From}";
}

/// <summary>One email: plain text, and the same as simple HTML when there is any.</summary>
public sealed record OutgoingMail(string To, string Subject, string Text, string? Html = null);

/// <summary>Why an email did not go, in words an admin can act on (the mail server's own answer).</summary>
public sealed class MailException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// Sends email (spec: PL-122). The SMTP adapter is the one there is; an API one (Postmark, Resend)
/// can join it for the hosted service. Reads the live settings at each send, so a save on the
/// admin page applies at once.
/// </summary>
public interface IMailSender
{
    /// <summary>Whether the server has email set up (<c>SMTP_HOST</c>).</summary>
    bool Configured { get; }

    /// <summary>Send one email; a <see cref="MailException"/> says why it did not go.</summary>
    Task SendAsync(OutgoingMail mail, CancellationToken cancellation = default);
}
