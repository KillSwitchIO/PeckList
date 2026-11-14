using System.Net;
using System.Net.Http.Json;
using System.Threading.RateLimiting;
using MailKit.Net.Smtp;
using Microsoft.AspNetCore.Http;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NSec.Cryptography;
using PeckList.Core.Supporters;
using PeckList.Keys;

namespace PeckList.Keys.Tests;

/// <summary>Paddle's signature as its docs give it, checked both ways.</summary>
public sealed class PaddleSignatureTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 12, 0, 0, TimeSpan.Zero);
    private static readonly byte[] Body = Encoding.UTF8.GetBytes("""{"event_type":"transaction.completed"}""");

    [Fact]
    public void A_body_signed_with_the_secret_checks_out_and_nothing_else_does()
    {
        var header = PaddleSignature.Sign(Body, "pdl_ntfset_secret", Now);
        Assert.True(PaddleSignature.IsValid(header, Body, "pdl_ntfset_secret", Now));
        Assert.False(PaddleSignature.IsValid(header, Body, "another secret", Now));
        Assert.False(PaddleSignature.IsValid(header, [.. Body, (byte)' '], "pdl_ntfset_secret", Now));
        Assert.False(PaddleSignature.IsValid(null, Body, "pdl_ntfset_secret", Now));
        Assert.False(PaddleSignature.IsValid("h1=abc", Body, "pdl_ntfset_secret", Now));
        Assert.False(PaddleSignature.IsValid("ts=1;h1=zz", Body, "pdl_ntfset_secret", Now));
    }

    [Fact]
    public void The_signature_is_hmac_sha256_over_the_time_a_colon_and_the_body_in_hex()
    {
        // Worked by hand: HMAC-SHA256("secret", "1700000000:{}").
        var expected = Convert.ToHexStringLower(System.Security.Cryptography.HMACSHA256.HashData("secret"u8, "1700000000:{}"u8));
        Assert.True(PaddleSignature.IsValid($"ts=1700000000;h1={expected}", "{}"u8, "secret", DateTimeOffset.FromUnixTimeSeconds(1700000000)));
    }

    [Fact]
    public void An_old_or_future_time_is_refused()
    {
        var header = PaddleSignature.Sign(Body, "s", Now);
        Assert.True(PaddleSignature.IsValid(header, Body, "s", Now.AddMinutes(4)));
        Assert.False(PaddleSignature.IsValid(header, Body, "s", Now.AddMinutes(6)));
        Assert.False(PaddleSignature.IsValid(header, Body, "s", Now.AddMinutes(-6)));
    }

    [Fact]
    public void While_secrets_rotate_any_one_of_several_signatures_will_do()
    {
        var good = PaddleSignature.Sign(Body, "new", Now);
        var h1 = good[(good.IndexOf("h1=", StringComparison.Ordinal) + 3)..];
        var ts = Now.ToUnixTimeSeconds();
        Assert.True(PaddleSignature.IsValid($"ts={ts};h1={new string('0', 64)};h1={h1}", Body, "new", Now));
    }
}

/// <summary>The service end to end, with stand-ins for Paddle's customer lookup and the mail server.</summary>
public sealed class KeyServiceTests : IDisposable
{
    private const string Secret = "pdl_ntfset_test_secret";
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private sealed class Customers : ICustomerEmails
    {
        public Task<string?> EmailOfAsync(string customerId, CancellationToken cancellation) =>
            Task.FromResult<string?>(customerId == "ctm_none" ? null : $"{customerId}@example.com");
    }

    private sealed class Mailer : IKeyMailer
    {
        public readonly List<(string To, IReadOnlyList<IssuedKey> Keys)> Sent = [];
        public bool Fail { get; set; }

        public Task SendAsync(string to, IReadOnlyList<IssuedKey> keys, CancellationToken cancellation)
        {
            if (Fail) throw new InvalidOperationException("mail server down");
            lock (Sent) Sent.Add((to, keys));
            return Task.CompletedTask;
        }
    }

    private readonly string folder = Directory.CreateTempSubdirectory("pecklist-keys-").FullName;
    private readonly Key signing = Key.Create(SignatureAlgorithm.Ed25519, new KeyCreationParameters { ExportPolicy = KeyExportPolicies.AllowPlaintextExport });
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

    private WebApplicationFactory<Program> Start() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(host => host
            .UseSetting("KEYS_SIGNING_KEY_FILE", File("signing", Convert.ToBase64String(signing.Export(KeyBlobFormat.RawPrivateKey)))
            ).UseSetting("PADDLE_WEBHOOK_SECRET_FILE", File("webhook", Secret))
            .UseSetting("PADDLE_API_KEY_FILE", File("api", "pdl_sdbx_apikey_test"))
            .UseSetting("PADDLE_PRICE_PERSON", "pri_person")
            .UseSetting("PADDLE_PRICE_SERVER", "pri_server_a, pri_server_b")
            .UseSetting("KEYS_DB", Path.Combine(folder, "keys.db"))
            .UseSetting("SMTP_HOST", "mail.invalid")
            .UseSetting("SMTP_FROM", "keys@example.com")
            .ConfigureTestServices(services =>
            {
                services.AddSingleton<ICustomerEmails>(new Customers());
                services.AddSingleton<IKeyMailer>(mailer);
            }));

    private static string Completed(string transaction, string customer = "ctm_buyer", params (string Price, int Quantity)[] items) =>
        JsonSerializer.Serialize(new
        {
            event_id = "evt_01",
            event_type = "transaction.completed",
            occurred_at = "2026-11-12T08:00:00.000Z",
            notification_id = "ntf_01",
            data = new
            {
                id = transaction,
                status = "completed",
                customer_id = customer,
                billed_at = "2026-11-11T23:30:00.000Z",
                items = items.Select(item => new { price = new { id = item.Price }, quantity = item.Quantity }),
            },
        });

    private static async Task<HttpResponseMessage> Deliver(HttpClient client, string body, string secret = Secret)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/public/paddle/webhook") { Content = new ByteArrayContent(bytes) };
        request.Content.Headers.ContentType = new("application/json");
        request.Headers.Add("Paddle-Signature", PaddleSignature.Sign(bytes, secret, DateTimeOffset.UtcNow));
        return await client.SendAsync(request, Token);
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
    public async Task A_paid_order_gets_one_signed_key_per_item_bought_dated_by_the_purchase_and_emailed()
    {
        using var server = Start();
        using var client = server.CreateClient();
        var response = await Deliver(client, Completed("txn_01", "ctm_buyer", ("pri_person", 1), ("pri_server_b", 2)));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var mail = Assert.Single(await MailsAsync(server, 1));
        Assert.Equal("ctm_buyer@example.com", mail.To);
        Assert.Equal([SupporterKind.Person, SupporterKind.Server, SupporterKind.Server], mail.Keys.Select(key => key.Kind));
        foreach (var issued in mail.Keys)
        {
            var key = SupporterKey.Parse(issued.Key)!;
            Assert.Equal(new DateOnly(2026, 11, 11), key.Purchased);
            Assert.Equal(issued.Kind, key.Kind);
            Assert.True(SignatureAlgorithm.Ed25519.Verify(signing.PublicKey, key.Signed, key.Signature));
        }
        Assert.Equal(3, mail.Keys.Select(key => key.Key).Distinct().Count());
        Assert.Contains(mail.Keys[0].Key, KeyMail.Text(mail.Keys));
    }

    [Fact]
    public async Task A_repeated_notification_finds_the_same_keys_and_mails_once()
    {
        using var server = Start();
        using var client = server.CreateClient();
        var body = Completed("txn_02", "ctm_buyer", ("pri_person", 1));
        Assert.Equal(HttpStatusCode.OK, (await Deliver(client, body)).StatusCode);
        await MailsAsync(server, 1);
        Assert.Equal(HttpStatusCode.OK, (await Deliver(client, body)).StatusCode);
        await server.Services.GetRequiredService<KeyMailing>().SendWaitingAsync(Token);

        Assert.Single(mailer.Sent);
        Assert.Single(await server.Services.GetRequiredService<KeyStore>().ForAsync("txn_02"));
    }

    [Fact]
    public async Task Without_the_right_signature_nothing_is_issued()
    {
        using var server = Start();
        using var client = server.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Deliver(client, Completed("txn_03", "ctm_buyer", ("pri_person", 1)), "wrong")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/public/paddle/webhook", new StringContent("{}"), Token)).StatusCode);
        Assert.Empty(await server.Services.GetRequiredService<KeyStore>().ForAsync("txn_03"));
    }

    [Fact]
    public async Task Other_events_and_other_products_are_answered_and_ignored()
    {
        using var server = Start();
        using var client = server.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await Deliver(client, Completed("txn_04", "ctm_buyer", ("pri_something_else", 1)))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Deliver(client, """{"event_type":"transaction.created","data":{"id":"txn_05"}}""")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Deliver(client, "not json")).StatusCode);
        Assert.Empty(await server.Services.GetRequiredService<KeyStore>().ForAsync("txn_04"));
        Assert.Empty(await server.Services.GetRequiredService<KeyStore>().ForAsync("txn_05"));
    }

    [Fact]
    public async Task The_thank_you_page_shows_the_keys_and_says_when_they_are_not_made_yet()
    {
        using var server = Start();
        using var client = server.CreateClient();
        var pending = await client.GetAsync("/api/public/thanks/txn_06", Token);
        Assert.Equal(HttpStatusCode.Accepted, pending.StatusCode);
        Assert.True(pending.Headers.CacheControl?.NoStore);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/public/thanks/not-a-transaction", Token)).StatusCode);

        await Deliver(client, Completed("txn_06", "ctm_buyer", ("pri_server_a", 1)));
        var found = await client.GetAsync("/api/public/thanks/txn_06", Token);
        // Keys in the answer: no proxy or CDN may keep it.
        Assert.True(found.Headers.CacheControl?.NoStore);
        using var page = JsonDocument.Parse(await found.Content.ReadAsStringAsync(Token));
        var key = Assert.Single(page.RootElement.GetProperty("keys").EnumerateArray());
        Assert.Equal("server", key.GetProperty("kind").GetString());
        Assert.StartsWith("PECKLIST-20261111-V-", key.GetProperty("key").GetString());
    }

    [Fact]
    public async Task Mail_that_fails_is_tried_again_and_the_email_is_never_stored()
    {
        using var server = Start();
        using var client = server.CreateClient();
        mailer.Fail = true;
        await Deliver(client, Completed("txn_07", "ctm_later", ("pri_person", 1)));
        var mailing = server.Services.GetRequiredService<KeyMailing>();
        await mailing.SendWaitingAsync(Token);
        Assert.Empty(mailer.Sent);

        mailer.Fail = false;
        var mail = Assert.Single(await MailsAsync(server, 1));
        Assert.Equal("ctm_later@example.com", mail.To);
        Assert.NotNull((await server.Services.GetRequiredService<KeyStore>().ForAsync("txn_07"))[0].EmailedAt);

        // The database holds the order's id and keys, nothing about the buyer: the customer id goes
        // once the mail is out.
        Assert.Equal(0, await CustomerIdsAsync());
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        foreach (var file in Directory.GetFiles(folder, "keys.db*"))
        {
            Assert.DoesNotContain("@example.com", Encoding.UTF8.GetString(await System.IO.File.ReadAllBytesAsync(file, Token)));
        }
    }

    private async Task<long> CustomerIdsAsync()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={Path.Combine(folder, "keys.db")};Pooling=False");
        await connection.OpenAsync(Token);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM issued_keys WHERE customer_id IS NOT NULL";
        return (long)(await command.ExecuteScalarAsync(Token))!;
    }

    [Fact]
    public async Task Mail_given_up_on_forgets_the_customer_too()
    {
        using var server = Start();
        using var client = server.CreateClient();
        mailer.Fail = true;
        await Deliver(client, Completed("txn_08", "ctm_unlucky", ("pri_person", 1)));
        await server.Services.GetRequiredService<KeyMailing>().SendWaitingAsync(Token);
        Assert.Equal(1, await CustomerIdsAsync());

        // The last try: nothing will ask Paddle about this order again.
        await server.Services.GetRequiredService<KeyStore>().MarkTriedAsync("txn_08", maxTries: 2);
        Assert.Equal(0, await CustomerIdsAsync());
    }

    [Fact]
    public void One_caller_at_its_limit_leaves_everyone_else_free()
    {
        using var limiter = PartitionedRateLimiter.Create(KeyLimits.PerClient(3));
        bool Take(string address)
        {
            using var lease = limiter.AttemptAcquire(new DefaultHttpContext { Connection = { RemoteIpAddress = IPAddress.Parse(address) } });
            return lease.IsAcquired;
        }

        for (var i = 0; i < 3; i++) Assert.True(Take("203.0.113.5"));
        Assert.False(Take("203.0.113.5"));
        Assert.True(Take("198.51.100.7"));

        // One IPv6 /64 is one caller, however many of its addresses it uses.
        for (var i = 1; i <= 3; i++) Assert.True(Take($"2001:db8:1:2::{i}"));
        Assert.False(Take("2001:db8:1:2:ffff::9"));
        Assert.True(Take("2001:db8:1:3::1"));
        Assert.False(Take("::ffff:203.0.113.5"));
    }

    [Fact]
    public void Refused_webhook_calls_are_logged_once_a_minute_with_their_count()
    {
        var log = new RefusalLog(TimeSpan.FromMinutes(1));
        var start = new DateTimeOffset(2026, 11, 13, 12, 0, 0, TimeSpan.Zero);
        Assert.Equal(1, log.Add(start));
        Assert.Equal(0, log.Add(start.AddSeconds(10)));
        Assert.Equal(0, log.Add(start.AddSeconds(50)));
        Assert.Equal(3, log.Add(start.AddSeconds(61)));
    }

    [Fact]
    public void A_mail_failure_is_logged_without_the_address_in_it()
    {
        var refused = new SmtpCommandException(SmtpErrorCode.RecipientNotAccepted, SmtpStatusCode.MailboxUnavailable,
            new MimeKit.MailboxAddress("", "buyer@example.com"), "550 <buyer@example.com>: no such user");
        var text = KeyMailing.Describe(refused);
        Assert.DoesNotContain("@", text);
        Assert.Contains("550", text);
        Assert.Equal("InvalidOperationException", KeyMailing.Describe(new InvalidOperationException("buyer@example.com")));
    }

    private IConfiguration Settings(params (string Name, string Value)[] extra)
    {
        var values = new Dictionary<string, string?>
        {
            ["KEYS_SIGNING_KEY_FILE"] = File("signing", Convert.ToBase64String(signing.Export(KeyBlobFormat.RawPrivateKey))),
            ["PADDLE_WEBHOOK_SECRET_FILE"] = File("webhook", Secret),
            ["PADDLE_API_KEY_FILE"] = File("api", "pdl_sdbx_apikey_test"),
            ["PADDLE_PRICE_PERSON"] = "pri_person",
            ["PADDLE_PRICE_SERVER"] = "pri_server",
            ["SMTP_HOST"] = "mail.example.com",
            ["SMTP_FROM"] = "keys@example.com",
        };
        foreach (var (name, value) in extra) values[name] = value;
        return new ConfigurationBuilder().AddInMemoryCollection(values).Build();
    }

    [Fact]
    public void Trusted_proxies_are_addresses_or_networks()
    {
        var proxies = KeySettings.From(Settings(("KEYS_TRUSTED_PROXIES", "192.0.2.10, 198.51.100.0/24, 2001:db8::1"))).TrustedProxies;
        Assert.Equal(3, proxies.Count);
        Assert.True(proxies[0].Contains(IPAddress.Parse("192.0.2.10")));
        Assert.False(proxies[0].Contains(IPAddress.Parse("192.0.2.11")));
        Assert.True(proxies[1].Contains(IPAddress.Parse("198.51.100.77")));
        Assert.Empty(KeySettings.From(Settings()).TrustedProxies);
        Assert.Contains("KEYS_TRUSTED_PROXIES", Assert.Throws<KeySettingsException>(() => KeySettings.From(Settings(("KEYS_TRUSTED_PROXIES", "proxy.example.com")))).Message);
    }

    [Fact]
    public void An_smtp_password_never_goes_out_unencrypted_except_to_a_relay_on_this_host()
    {
        var error = Assert.Throws<KeySettingsException>(() => KeySettings.From(Settings(("SMTP_TLS", "none"), ("SMTP_USER", "keys"))));
        Assert.Contains("SMTP_TLS", error.Message);
        Assert.Equal("none", KeySettings.From(Settings(("SMTP_TLS", "none"), ("SMTP_USER", "keys"), ("SMTP_HOST", "localhost"))).Mail.Tls);
        Assert.Equal("none", KeySettings.From(Settings(("SMTP_TLS", "none"), ("SMTP_USER", "keys"), ("SMTP_HOST", "127.0.0.1"))).Mail.Tls);
        Assert.Null(KeySettings.From(Settings(("SMTP_TLS", "none"))).Mail.User);
    }

    [Fact]
    public async Task The_health_check_finds_the_port_and_fails_when_nothing_answers()
    {
        Assert.Equal(8080, KeysHealthCheck.Port("http://+:8080"));
        Assert.Equal(9000, KeysHealthCheck.Port("http://+:9000;https://+:9443"));
        Assert.Equal(8080, KeysHealthCheck.Port(null));
        // A port nothing listens on: taken, then let go.
        var listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var free = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        Assert.Equal(1, await KeysHealthCheck.RunAsync($"http://+:{free}", TimeSpan.FromSeconds(2)));
    }

    [Fact]
    public void A_missing_setting_is_named()
    {
        var config = new Microsoft.Extensions.Configuration.ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["PADDLE_ENVIRONMENT"] = "sandbox" }).Build();
        var error = Assert.Throws<KeySettingsException>(() => KeySettings.From(config));
        Assert.Contains("PADDLE_PRICE_PERSON", error.Message);
    }
}
