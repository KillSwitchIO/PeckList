using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using NSec.Cryptography;
using PeckList.Core.Supporters;

namespace PeckList.Keys.Tests;

/// <summary>The service with BTCPay Server as an order source, alone and beside Paddle, against the stand-ins.</summary>
public sealed class BtcPayServiceTests : IDisposable
{
    private const string Store = "StoreAbc123";
    private const string WebhookSecret = "btcpay-whsec-test";
    private const string ApiKey = "btcpay-apikey-test";
    private const string PaddleSecret = "pdl_ntfset_test_secret";
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private sealed class Mailer : IKeyMailer
    {
        public readonly List<(string To, IReadOnlyList<IssuedKey> Keys)> Sent = [];

        public Task SendAsync(string to, IReadOnlyList<IssuedKey> keys, CancellationToken cancellation)
        {
            lock (Sent) Sent.Add((to, keys));
            return Task.CompletedTask;
        }
    }

    private readonly string folder = Directory.CreateTempSubdirectory("pecklist-keys-btcpay-").FullName;
    private readonly Key signing = Key.Create(SignatureAlgorithm.Ed25519, new KeyCreationParameters { ExportPolicy = KeyExportPolicies.AllowPlaintextExport });
    private readonly FakeBtcPay btcpay = new(Store, WebhookSecret, ApiKey);
    private readonly FakePaddle paddle = new(PaddleSecret, "pdl_apikey_test");
    private readonly Mailer mailer = new();

    public void Dispose()
    {
        signing.Dispose();
        try
        {
            Directory.Delete(folder, recursive: true);
        }
        catch (IOException)
        {
            // SQLite may still hold the file a moment; the temp folder is cleaned up anyway.
        }
    }

    private string File(string name, string content)
    {
        var path = Path.Combine(folder, name);
        System.IO.File.WriteAllText(path, content);
        return path;
    }

    private WebApplicationFactory<Program> Start(bool withPaddle = false) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(host =>
        {
            host.UseSetting("KEYS_SIGNING_KEY_FILE", File("signing", Convert.ToBase64String(signing.Export(KeyBlobFormat.RawPrivateKey))))
                .UseSetting("BTCPAY_URL", FakeBtcPay.Url)
                .UseSetting("BTCPAY_STORE_ID", Store)
                .UseSetting("BTCPAY_WEBHOOK_SECRET_FILE", File("btcpay-webhook", WebhookSecret))
                .UseSetting("BTCPAY_API_KEY_FILE", File("btcpay-api", ApiKey))
                .UseSetting("BTCPAY_ITEM_PERSON", "supporter-person")
                .UseSetting("BTCPAY_ITEM_SERVER", "supporter-server")
                .UseSetting("BTCPAY_CURRENCY", "USD")
                .UseSetting("BTCPAY_PRICE_PERSON", "5")
                .UseSetting("BTCPAY_PRICE_SERVER", "25")
                .UseSetting("KEYS_DB", Path.Combine(folder, "keys.db"))
                .UseSetting("SMTP_HOST", "mail.invalid")
                .UseSetting("SMTP_FROM", "keys@example.com")
                .ConfigureTestServices(services =>
                {
                    services.AddHttpClient(BtcPaySource.Name).ConfigurePrimaryHttpMessageHandler(btcpay.Handler);
                    services.AddHttpClient(PaddleSource.Name).ConfigurePrimaryHttpMessageHandler(paddle.Handler);
                    services.AddSingleton<IKeyMailer>(mailer);
                });
            if (withPaddle)
            {
                host.UseSetting("PADDLE_WEBHOOK_SECRET_FILE", File("paddle-webhook", PaddleSecret))
                    .UseSetting("PADDLE_API_KEY_FILE", File("paddle-api", "pdl_apikey_test"))
                    .UseSetting("PADDLE_API_URL", FakePaddle.Api)
                    .UseSetting("PADDLE_PRICE_PERSON", "pri_person")
                    .UseSetting("PADDLE_PRICE_SERVER", "pri_server");
            }
        });

    private static async Task<HttpResponseMessage> Post(HttpClient client, string path, string header, (string Signature, byte[] Body) webhook)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new ByteArrayContent(webhook.Body) };
        request.Content.Headers.ContentType = new("application/json");
        request.Headers.Add(header, webhook.Signature);
        return await client.SendAsync(request, Token);
    }

    private Task<HttpResponseMessage> Settle(HttpClient client, FakeBtcPay.Invoice invoice)
    {
        btcpay.Invoices[invoice.Id] = invoice;
        return Post(client, "/api/public/btcpay/webhook", "BTCPay-Sig", btcpay.Webhook(invoice.Id));
    }

    private async Task<IReadOnlyList<(string To, IReadOnlyList<IssuedKey> Keys)>> MailsAsync(WebApplicationFactory<Program> server, int expected)
    {
        var mailing = server.Services.GetRequiredService<KeyMailing>();
        for (var round = 0; round < 50 && mailer.Sent.Count < expected; round++)
        {
            await mailing.SendWaitingAsync(Token);
            if (mailer.Sent.Count < expected) await Task.Delay(20, Token);
        }
        lock (mailer.Sent) return [.. mailer.Sent];
    }

    [Fact]
    public async Task A_settled_invoice_gets_a_signed_key_mailed_to_its_buyer_and_shown_on_the_thank_you_page()
    {
        using var server = Start();
        using var client = server.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await Settle(client, new FakeBtcPay.Invoice("W7Ay3xkRbBnJz2EqVdF1sP", "supporter-server", 25m, BuyerEmail: "satoshi@example.com"))).StatusCode);

        var mail = Assert.Single(await MailsAsync(server, 1));
        Assert.Equal("satoshi@example.com", mail.To);
        var issued = Assert.Single(mail.Keys);
        var key = SupporterKey.Parse(issued.Key)!;
        Assert.Equal(SupporterKind.Server, key.Kind);
        Assert.Equal(new DateOnly(2025, 11, 13), key.Purchased);
        Assert.True(SignatureAlgorithm.Ed25519.Verify(signing.PublicKey, key.Signed, key.Signature));

        var page = await client.GetAsync("/api/public/thanks/btcpay/W7Ay3xkRbBnJz2EqVdF1sP", Token);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.True(page.Headers.CacheControl?.NoStore);
        using var json = JsonDocument.Parse(await page.Content.ReadAsStringAsync(Token));
        Assert.Equal(issued.Key, Assert.Single(json.RootElement.GetProperty("keys").EnumerateArray()).GetProperty("key").GetString());

        // BTCPay only: no Paddle webhook, and Paddle's thank-you address finds nothing.
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/public/paddle/webhook", new StringContent("{}"), Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/public/thanks/txn_01", Token)).StatusCode);
    }

    [Fact]
    public async Task A_repeated_webhook_issues_nothing_more_and_mails_once()
    {
        using var server = Start();
        using var client = server.CreateClient();
        var invoice = new FakeBtcPay.Invoice("Q9Lm4tCwYh8KpRs2NvXe5u", "supporter-person", 5m);
        await Settle(client, invoice);
        await MailsAsync(server, 1);
        Assert.Equal(HttpStatusCode.OK, (await Settle(client, invoice)).StatusCode);
        await server.Services.GetRequiredService<KeyMailing>().SendWaitingAsync(Token);

        Assert.Single(mailer.Sent);
        Assert.Single(await server.Services.GetRequiredService<KeyStore>().ForAsync("btcpay", invoice.Id));
    }

    [Fact]
    public async Task A_bad_signature_is_refused_and_issues_nothing()
    {
        using var server = Start();
        using var client = server.CreateClient();
        btcpay.Invoices["BadSigAbcdefghij"] = new FakeBtcPay.Invoice("BadSigAbcdefghij", "supporter-person", 5m);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await Post(client, "/api/public/btcpay/webhook", "BTCPay-Sig", btcpay.Webhook("BadSigAbcdefghij", secret: "wrong"))).StatusCode);
        // Signed for BTCPay, sent with Paddle's header name: still unsigned.
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await Post(client, "/api/public/btcpay/webhook", "Paddle-Signature", btcpay.Webhook("BadSigAbcdefghij"))).StatusCode);
        Assert.Empty(await server.Services.GetRequiredService<KeyStore>().ForAsync("btcpay", "BadSigAbcdefghij"));
        Assert.Empty(btcpay.Calls);
    }

    [Fact]
    public async Task While_btcpay_cannot_be_asked_the_webhook_is_refused_so_btcpay_sends_it_again()
    {
        using var server = Start();
        using var client = server.CreateClient();
        var invoice = new FakeBtcPay.Invoice("RetryAbcdefghijk", "supporter-person", 5m);
        btcpay.Broken = HttpStatusCode.ServiceUnavailable;
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await Settle(client, invoice)).StatusCode);
        Assert.Empty(await server.Services.GetRequiredService<KeyStore>().ForAsync("btcpay", invoice.Id));
        btcpay.Broken = null;
        Assert.Equal(HttpStatusCode.OK, (await Settle(client, invoice)).StatusCode);
        Assert.Single(await server.Services.GetRequiredService<KeyStore>().ForAsync("btcpay", invoice.Id));
    }

    [Fact]
    public async Task Paddle_and_btcpay_side_by_side_each_issue_and_each_has_its_own_thank_you_address()
    {
        using var server = Start(withPaddle: true);
        using var client = server.CreateClient();
        paddle.Customers["ctm_card"] = "card@example.com";
        var paddleOrder = paddle.Notification(FakePaddle.Completed("txn_side01", "ctm_card", ("pri_person", 1)));
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "/api/public/paddle/webhook", "Paddle-Signature", paddleOrder)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Settle(client, new FakeBtcPay.Invoice("SideBySideAbcdef", "supporter-person", 5m, BuyerEmail: "coin@example.com"))).StatusCode);

        var mails = await MailsAsync(server, 2);
        Assert.Equal(["card@example.com", "coin@example.com"], mails.Select(mail => mail.To).Order());
        foreach (var (path, status) in new[]
        {
            ("/api/public/thanks/txn_side01", HttpStatusCode.OK),
            ("/api/public/thanks/paddle/txn_side01", HttpStatusCode.OK),
            ("/api/public/thanks/btcpay/SideBySideAbcdef", HttpStatusCode.OK),
            // An order is found only under its own provider.
            ("/api/public/thanks/paddle/SideBySideAbcdef", HttpStatusCode.NotFound),
            ("/api/public/thanks/btcpay/txn_side01", HttpStatusCode.NotFound),
            ("/api/public/thanks/kofi/SideBySideAbcdef", HttpStatusCode.NotFound),
        })
        {
            Assert.True(status == (await client.GetAsync(path, Token)).StatusCode, path);
        }
    }

    [Fact]
    public async Task Keys_issued_before_btcpay_become_paddle_orders_and_are_still_found()
    {
        // A database from the Paddle-only service.
        await using (var old = new SqliteConnection($"Data Source={Path.Combine(folder, "keys.db")};Pooling=False"))
        {
            await old.OpenAsync(Token);
            await using var command = old.CreateCommand();
            command.CommandText = """
                CREATE TABLE issued_keys (transaction_id TEXT NOT NULL, item INTEGER NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL,
                    customer_id TEXT, issued_at TEXT NOT NULL, emailed_at TEXT, mail_tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (transaction_id, item));
                INSERT INTO issued_keys VALUES ('txn_before', 0, 'person', 'PECKLIST-20261120-S-OLDKEY', 'ctm_waiting', '2099-01-01T00:00:00.0000000+00:00', NULL, 3);
                """;
            await command.ExecuteNonQueryAsync(Token);
        }
        using var server = Start(withPaddle: true);
        using var client = server.CreateClient();
        var page = await client.GetAsync("/api/public/thanks/txn_before", Token);
        Assert.Contains("PECKLIST-20261120-S-OLDKEY", await page.Content.ReadAsStringAsync(Token));
        var waiting = Assert.Single(await server.Services.GetRequiredService<KeyStore>().UnmailedAsync(KeyMailing.MaxTries));
        Assert.Equal(("paddle", "txn_before", "ctm_waiting"), (waiting.Provider, waiting.OrderId, waiting.Contact));
        // Its tries carry over (the mailer may already have made one more since the start).
        Assert.True(waiting.Tries >= 3, $"tries {waiting.Tries}");
    }
}
