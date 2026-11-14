using System.Text;
using System.Threading.Channels;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using PeckList.Core.Supporters;

namespace PeckList.Keys;

/// <summary>Sends a buyer their keys.</summary>
public interface IKeyMailer
{
    Task SendAsync(string to, IReadOnlyList<IssuedKey> keys, CancellationToken cancellation);
}

/// <summary>The email a buyer gets: the keys, where each goes, and that it never expires.</summary>
public static class KeyMail
{
    public static string Subject(IReadOnlyList<IssuedKey> keys) =>
        keys.Count == 1 && keys[0].Kind == SupporterKind.Server ? "Your PeckList server supporter key" : keys.Count == 1 ? "Your PeckList supporter key" : "Your PeckList supporter keys";

    public static string Text(IReadOnlyList<IssuedKey> keys)
    {
        var text = new StringBuilder("Thank you for supporting PeckList!\n\n");
        foreach (var key in keys)
        {
            text.Append(key.Kind == SupporterKind.Person ? "Supporter key (one person):\n" : "Server supporter key (everyone on one server):\n");
            text.Append(key.Key).Append("\n\n");
        }
        if (keys.Any(key => key.Kind == SupporterKind.Person))
        {
            text.Append("For a supporter key, open Settings > Support PeckList in PeckList and paste it into \"Enter your key\".\n");
        }
        if (keys.Any(key => key.Kind == SupporterKind.Server))
        {
            text.Append("For a server key, an admin opens Admin > Support in PeckList and pastes it in. It covers everyone on that server.\n");
        }
        text.Append("\nKeep this email: a key never expires. It unlocks nothing; every feature works without one. It just says thank you.\n");
        return text.ToString();
    }
}

/// <summary>Email through SMTP with MailKit, as PeckList servers send theirs.</summary>
public sealed class SmtpKeyMailer(KeySettings settings) : IKeyMailer
{
    public async Task SendAsync(string to, IReadOnlyList<IssuedKey> keys, CancellationToken cancellation)
    {
        var mail = settings.Mail;
        var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(mail.From));
        message.To.Add(MailboxAddress.Parse(to));
        message.Subject = KeyMail.Subject(keys);
        message.Body = new TextPart("plain") { Text = KeyMail.Text(keys) };
        using var client = new SmtpClient { Timeout = 30_000 };
        await client.ConnectAsync(mail.Host, mail.Port, mail.Tls switch
        {
            "tls" => SecureSocketOptions.SslOnConnect,
            "none" => SecureSocketOptions.None,
            _ => SecureSocketOptions.StartTls,
        }, cancellation);
        if (mail.User is { } user) await client.AuthenticateAsync(user, mail.Password ?? "", cancellation);
        await client.SendAsync(message, cancellation);
        await client.DisconnectAsync(true, cancellation);
    }
}

/// <summary>
/// Emails issued keys, off the webhook's back (Paddle wants an answer within seconds): at once
/// when an order comes in, and every few minutes for any that failed, up to <see cref="MaxTries"/>.
/// The buyer's email is asked of Paddle each time and never kept. Should mail fail for good, the
/// website's thank-you page still shows the keys for a week, and support can look them up.
/// </summary>
public sealed class KeyMailing(KeyStore store, ICustomerEmails customers, IKeyMailer mailer, TimeProvider time, ILogger<KeyMailing> logger) : BackgroundService
{
    public const int MaxTries = 100;
    private static readonly TimeSpan RetryEvery = TimeSpan.FromMinutes(3);
    private readonly Channel<bool> nudges = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });

    /// <summary>Mail what is waiting now rather than at the next round.</summary>
    public void Nudge() => nudges.Writer.TryWrite(true);

    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        while (!stopping.IsCancellationRequested)
        {
            await SendWaitingAsync(stopping);
            using var wait = CancellationTokenSource.CreateLinkedTokenSource(stopping);
            wait.CancelAfter(RetryEvery);
            try
            {
                await nudges.Reader.ReadAsync(wait.Token);
            }
            catch (OperationCanceledException) when (!stopping.IsCancellationRequested)
            {
                // The round's time is up.
            }
        }
    }

    // One round at a time: the nudge and the timer may meet, and an order must go out once.
    private readonly SemaphoreSlim sending = new(1, 1);

    public async Task SendWaitingAsync(CancellationToken cancellation)
    {
        await sending.WaitAsync(cancellation);
        try
        {
            await SendRoundAsync(cancellation);
        }
        finally
        {
            sending.Release();
        }
    }

    private async Task SendRoundAsync(CancellationToken cancellation)
    {
        IReadOnlyList<(string TransactionId, string? CustomerId, int Tries)> waiting;
        try
        {
            waiting = await store.UnmailedAsync(MaxTries);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            logger.LogError(error, "Could not read the keys waiting to be emailed");
            return;
        }
        foreach (var (transactionId, customerId, tries) in waiting)
        {
            try
            {
                var email = customerId is null ? null : await customers.EmailOfAsync(customerId, cancellation);
                if (email is null)
                {
                    logger.LogWarning("Order {Transaction} has no customer email to send its keys to", transactionId);
                    await store.MarkTriedAsync(transactionId, MaxTries);
                    continue;
                }
                await mailer.SendAsync(email, await store.ForAsync(transactionId), cancellation);
                await store.MarkMailedAsync(transactionId, time.GetUtcNow());
                logger.LogInformation("Emailed the keys of order {Transaction}", transactionId);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                await store.MarkTriedAsync(transactionId, MaxTries);
                var level = tries + 1 >= MaxTries ? LogLevel.Error : LogLevel.Warning;
                logger.Log(level, "Emailing the keys of order {Transaction} failed (try {Try} of {Max}): {Error}", transactionId, tries + 1, MaxTries, Describe(error));
            }
        }
    }

    /// <summary>
    /// What went wrong, for the log, without the exception's message: a mail server's refusal
    /// usually quotes the recipient (550 &lt;someone@example.com&gt;), and buyers' addresses are never kept.
    /// </summary>
    public static string Describe(Exception error) => error switch
    {
        SmtpCommandException command => $"{nameof(SmtpCommandException)} {command.ErrorCode} ({(int)command.StatusCode})",
        HttpRequestException http => $"{nameof(HttpRequestException)} ({(http.StatusCode is { } status ? ((int)status).ToString(System.Globalization.CultureInfo.InvariantCulture) : "no answer")})",
        _ => error.GetType().Name,
    };
}
