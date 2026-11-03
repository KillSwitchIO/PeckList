using System.Net;
using System.Net.Sockets;
using System.Text;

namespace Punchlist.Server.Tests;

/// <summary>
/// Just enough SMTP for tests (no TLS, no login): takes one message per connection and keeps its
/// raw text. <paramref name="refuseRecipients"/> answers RCPT TO with a 550, as a relay that says no.
/// </summary>
public sealed class FakeSmtpServer : IAsyncDisposable
{
    private readonly TcpListener listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource stop = new();
    private readonly Task loop;
    private readonly bool refuseRecipients;

    public FakeSmtpServer(bool refuseRecipients = false)
    {
        this.refuseRecipients = refuseRecipients;
        listener.Start();
        loop = Task.Run(AcceptAsync);
    }

    public int Port => ((IPEndPoint)listener.LocalEndpoint).Port;

    /// <summary>Each message's DATA, as it arrived.</summary>
    public List<string> Messages { get; } = [];

    private async Task AcceptAsync()
    {
        while (!stop.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await listener.AcceptTcpClientAsync(stop.Token);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            _ = Task.Run(() => ServeAsync(client));
        }
    }

    private async Task ServeAsync(TcpClient client)
    {
        using var _ = client;
        var stream = client.GetStream();
        var reader = new StreamReader(stream, Encoding.ASCII);
        var writer = new StreamWriter(stream, Encoding.ASCII) { NewLine = "\r\n", AutoFlush = true };
        await writer.WriteLineAsync("220 fake.test ESMTP");
        while (await reader.ReadLineAsync() is { } line)
        {
            var verb = line.Split(' ', 2)[0].ToUpperInvariant();
            switch (verb)
            {
                case "EHLO":
                    await writer.WriteLineAsync("250-fake.test");
                    await writer.WriteLineAsync("250 8BITMIME");
                    break;
                case "HELO" or "MAIL" or "RSET" or "NOOP":
                    await writer.WriteLineAsync("250 OK");
                    break;
                case "RCPT":
                    await writer.WriteLineAsync(refuseRecipients ? "550 5.7.1 relay denied" : "250 OK");
                    break;
                case "DATA":
                    await writer.WriteLineAsync("354 go on");
                    var data = new StringBuilder();
                    while (await reader.ReadLineAsync() is { } body && body != ".") data.AppendLine(body);
                    lock (Messages) Messages.Add(data.ToString());
                    await writer.WriteLineAsync("250 queued");
                    break;
                case "QUIT":
                    await writer.WriteLineAsync("221 bye");
                    return;
                default:
                    await writer.WriteLineAsync("502 not here");
                    break;
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await stop.CancelAsync();
        listener.Stop();
        try
        {
            await loop;
        }
        catch (OperationCanceledException)
        {
        }
        stop.Dispose();
    }
}
