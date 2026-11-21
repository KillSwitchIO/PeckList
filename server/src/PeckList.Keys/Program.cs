using System.Text.Json;
using Microsoft.AspNetCore.HttpOverrides;
using NSec.Cryptography;
using PeckList.Keys;

// The supporter key service (PL-112): a payment provider (Paddle, BTCPay Server) tells it an order
// is paid, it signs a supporter key for each one bought and emails them; the website's thank-you
// page can show them too. Settings are
// in KeySettings.cs. Two commands run once and exit:
//   pecklist-keys generate-signing-key <file>   makes the private key in <file> (never printed) and
//                                               prints the public half for PeckList to ship
//   pecklist-keys public-key [file]             prints the public half again (default: KEYS_SIGNING_KEY_FILE)
//   pecklist-keys healthcheck                   exits 0 when the running service answers its health
//                                               check (the image has no shell or curl for Docker's)
//
// Routes: what the internet may reach is under /api/public/ (each provider's webhook and the
// thank-you lookup); /api/private/ (the health check) is for the project's own network only.

if (args is ["generate-signing-key", var target])
{
    return SigningKeys.Generate(target);
}
if (args is ["public-key", ..])
{
    return SigningKeys.PrintPublic(args.Length > 1 ? args[1] : Environment.GetEnvironmentVariable("KEYS_SIGNING_KEY_FILE"));
}
if (args is ["healthcheck", ..])
{
    return await KeysHealthCheck.RunAsync(Environment.GetEnvironmentVariable("ASPNETCORE_URLS"));
}

var builder = WebApplication.CreateBuilder(args);
KeySettings settings;
try
{
    settings = KeySettings.From(builder.Configuration);
}
catch (KeySettingsException error)
{
    Console.Error.WriteLine($"pecklist-keys: {error.Message}");
    return 2;
}

builder.Services.AddSingleton(settings);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(_ => new KeyIssuer(SigningKeys.Import(settings.SigningKey)));
builder.Services.AddSingleton<KeyStore>();
// The order sources set up (KeySettings): Paddle, BTCPay Server, or both.
if (settings.Paddle is { } paddle)
{
    builder.Services.AddHttpClient(PaddleSource.Name, http => http.Timeout = TimeSpan.FromSeconds(20));
    builder.Services.AddSingleton<IOrderSource>(provider => new PaddleSource(provider.GetRequiredService<IHttpClientFactory>(), paddle));
}
if (settings.BtcPay is { } btcpay)
{
    builder.Services.AddHttpClient(BtcPaySource.Name, http => http.Timeout = TimeSpan.FromSeconds(20));
    builder.Services.AddSingleton<IOrderSource>(provider => new BtcPaySource(
        provider.GetRequiredService<IHttpClientFactory>(), btcpay, provider.GetRequiredService<ILogger<BtcPaySource>>()));
}
builder.Services.AddSingleton<OrderSources>();
builder.Services.AddSingleton<IKeyMailer, SmtpKeyMailer>();
builder.Services.AddSingleton<KeyMailing>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<KeyMailing>());
builder.Services.AddCors(cors => cors.AddPolicy("site", policy => policy.WithOrigins(settings.SiteOrigin).WithMethods("GET")));
// Limits per caller, with an overall cap per route (KeyLimits).
builder.Services.AddRateLimiter(limits =>
{
    limits.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    limits.GlobalLimiter = KeyLimits.Overall();
    limits.AddPolicy("webhook", KeyLimits.PerClient(KeyLimits.WebhookPerClient));
    limits.AddPolicy("thanks", KeyLimits.PerClient(KeyLimits.ThanksPerClient));
});
// Behind the TLS proxy every connection comes from the proxy: trust its X-Forwarded-For, and only
// its, so each caller is counted by the address the proxy saw (the last one it added).
if (settings.TrustedProxies.Count > 0)
{
    builder.Services.Configure<ForwardedHeadersOptions>(forwarded =>
    {
        forwarded.ForwardedHeaders = ForwardedHeaders.XForwardedFor;
        forwarded.ForwardLimit = 1;
        forwarded.KnownIPNetworks.Clear();
        forwarded.KnownProxies.Clear();
        foreach (var network in settings.TrustedProxies) forwarded.KnownIPNetworks.Add(network);
    });
}
const long MaxBody = 256 * 1024;
builder.WebHost.ConfigureKestrel(kestrel => kestrel.Limits.MaxRequestBodySize = MaxBody);
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);

var app = builder.Build();
foreach (var setting in settings.CleartextApis())
{
    app.Logger.LogWarning(
        "{Setting} is plain http to a host outside this machine and its private networks, so the API key crosses the network unencrypted; use https", setting);
}
await app.Services.GetRequiredService<KeyStore>().MigrateAsync();
if (settings.TrustedProxies.Count > 0) app.UseForwardedHeaders();
app.UseCors();
app.UseRateLimiter();

app.MapGet("/api/private/healthz", () => Results.Text("ok"));

// Each provider's notification. Anything properly signed gets a 200, keys or not, so the provider
// stops retrying; a bad signature or a broken body is refused, and a provider that has to be asked
// about the order and cannot be reached gets a 503, so it sends the notification again.
var refusals = new RefusalLog(TimeSpan.FromMinutes(1));
foreach (var source in app.Services.GetRequiredService<OrderSources>().All)
{
    app.MapPost($"/api/public/{source.Provider}/webhook", async (HttpRequest request, KeyStore store, KeyIssuer issuer, KeyMailing mailing, TimeProvider time,
        ILogger<KeyStore> logger, CancellationToken cancellation) =>
    {
        using var buffer = new MemoryStream();
        await request.Body.CopyToAsync(buffer, cancellation);
        var body = buffer.ToArray();
        if (!source.IsSigned(request.Headers[source.SignatureHeader], body, time.GetUtcNow()))
        {
            if (refusals.Add(time.GetUtcNow()) is var count and > 0)
            {
                logger.LogWarning("Refused {Count} webhook calls with a missing or wrong signature (one warning a minute at most); the last was for {Provider}", count, source.Provider);
            }
            return Results.Unauthorized();
        }
        PaidOrder? order;
        try
        {
            order = await source.ReadAsync(body, cancellation);
        }
        catch (JsonException)
        {
            return Results.BadRequest();
        }
        catch (OrderSourceUnavailableException error)
        {
            logger.LogWarning("A {Provider} notification could not be checked: {Error}", source.Provider, error.Message);
            return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        }
        if (order is null) return Results.Ok();
        var keys = await store.IssueAsync(order, issuer, time.GetUtcNow(), cancellation);
        logger.LogInformation("Order {Provider} {Order}: {Count} supporter keys", order.Provider, order.OrderId, keys.Count);
        mailing.Nudge();
        return Results.Ok();
    }).RequireRateLimiting("webhook");
}

// The website's thank-you page, given the order id the provider hands its success page (Paddle's
// transaction id, the BTCPay invoice id): the order's keys for a week after they were made, so a
// lost email isn't a dead end. No proxy or CDN may keep an answer: it can hold keys.
static async Task<IResult> Thanks(string provider, string orderId, OrderSources sources, KeyStore store, TimeProvider time, HttpResponse response)
{
    response.Headers.CacheControl = "no-store";
    if (sources[provider] is not { } source || !source.IsOrderId(orderId)) return Results.NotFound();
    var keys = await store.ForAsync(provider, orderId);
    if (keys.Count == 0) return Results.Json(new { pending = true }, statusCode: StatusCodes.Status202Accepted);
    if (time.GetUtcNow() - keys[0].IssuedAt > TimeSpan.FromDays(7)) return Results.NotFound();
    return Results.Ok(new { keys = keys.Select(key => new { kind = key.Kind == PeckList.Core.Supporters.SupporterKind.Person ? "person" : "server", key = key.Key }) });
}
app.MapGet("/api/public/thanks/{provider}/{orderId}", (string provider, string orderId, OrderSources sources, KeyStore store, TimeProvider time, HttpResponse response) =>
    Thanks(provider, orderId, sources, store, time, response)).RequireCors("site").RequireRateLimiting("thanks");
// Before BTCPay the page asked with Paddle's transaction id alone; that address keeps working.
app.MapGet("/api/public/thanks/{transactionId}", (string transactionId, OrderSources sources, KeyStore store, TimeProvider time, HttpResponse response) =>
    Thanks(PaddleSource.Name, transactionId, sources, store, time, response)).RequireCors("site").RequireRateLimiting("thanks");

app.Run();
return 0;

/// <summary>The signing key: made once, by Ben, on the service's host; never printed or logged.</summary>
internal static class SigningKeys
{
    private static readonly SignatureAlgorithm Ed25519 = SignatureAlgorithm.Ed25519;

    public static Key Import(string base64) =>
        Key.Import(Ed25519, Convert.FromBase64String(base64), KeyBlobFormat.RawPrivateKey);

    public static int Generate(string path)
    {
        using var key = Key.Create(Ed25519, new KeyCreationParameters { ExportPolicy = KeyExportPolicies.AllowPlaintextExport });
        try
        {
            var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write };
            if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            using var file = new StreamWriter(new FileStream(path, options));
            file.Write(Convert.ToBase64String(key.Export(KeyBlobFormat.RawPrivateKey)));
        }
        catch (IOException error)
        {
            Console.Error.WriteLine($"pecklist-keys: could not make {path} (it must not exist yet): {error.Message}");
            return 1;
        }
        catch (UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"pecklist-keys: no permission to write {path}; its folder must be writable by uid {Environment.GetEnvironmentVariable("APP_UID") ?? "1654"}");
            return 1;
        }
        Console.WriteLine($"Made the signing key in {path}. Keep that file secret and backed up; this is its public half, for PeckList:");
        Console.WriteLine(Convert.ToBase64String(key.PublicKey.Export(KeyBlobFormat.RawPublicKey)));
        return 0;
    }

    public static int PrintPublic(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            Console.Error.WriteLine("pecklist-keys: name the key file, or set KEYS_SIGNING_KEY_FILE");
            return 2;
        }
        try
        {
            using var key = Import(File.ReadAllText(path).Trim());
            Console.WriteLine(Convert.ToBase64String(key.PublicKey.Export(KeyBlobFormat.RawPublicKey)));
            return 0;
        }
        catch (Exception error) when (error is IOException or FormatException or ArgumentException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"pecklist-keys: could not read a signing key from {path}: {error.Message}");
            return 1;
        }
    }
}

/// <summary>Docker's health check from inside the container: asks the service's own health route on loopback.</summary>
public static class KeysHealthCheck
{
    /// <summary>The port the service listens on, from ASPNETCORE_URLS (the image's http://+:8080), or 8080.</summary>
    public static int Port(string? urls)
    {
        var first = (urls ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault() ?? "";
        var colon = first.LastIndexOf(':');
        return colon >= 0 && int.TryParse(first.AsSpan(colon + 1).TrimEnd('/'), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var port) && port is > 0 and < 65536
            ? port
            : 8080;
    }

    public static async Task<int> RunAsync(string? urls, TimeSpan? timeout = null)
    {
        using var http = new HttpClient { Timeout = timeout ?? TimeSpan.FromSeconds(4) };
        try
        {
            using var response = await http.GetAsync(new Uri($"http://127.0.0.1:{Port(urls)}/api/private/healthz"));
            return response.IsSuccessStatusCode ? 0 : 1;
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            return 1;
        }
    }
}

public partial class Program;
