using System.Globalization;
using System.Net;
using System.Net.Sockets;

namespace PeckList.Keys;

/// <summary>
/// The service's settings, from the environment. Secrets come from files (<c>*_FILE</c>), so they
/// stay out of the environment and out of <c>docker inspect</c>:
///   KEYS_SIGNING_KEY_FILE       the Ed25519 private key, base64 of the raw 32 bytes (made by
///                               <c>pecklist-keys generate-signing-key</c>; required)
///   PADDLE_WEBHOOK_SECRET_FILE  the notification destination's secret key (required)
///   PADDLE_API_KEY_FILE         an API key with customer.read, to look up who to email (required)
///   PADDLE_ENVIRONMENT          sandbox (the default) or live
///   PADDLE_PRICE_PERSON         the price ids of the one-person key, comma-separated (required)
///   PADDLE_PRICE_SERVER         the price ids of the server key, comma-separated (required)
///   KEYS_DB                     the SQLite file for issued keys (default /data/keys.db)
///   KEYS_SITE_ORIGIN            the website whose thank-you page may look keys up (default https://pecklist.com)
///   KEYS_TRUSTED_PROXIES        the TLS proxy's addresses or networks, comma-separated, whose
///                               X-Forwarded-For names the caller for the rate limits (default: none)
///   SMTP_HOST, SMTP_PORT (587), SMTP_TLS (starttls, tls or none), SMTP_USER, SMTP_PASSWORD_FILE,
///   SMTP_FROM                   where key emails go out (SMTP_HOST and SMTP_FROM required; none
///                               with SMTP_USER only for a relay on this host)
///   ASPNETCORE_URLS             where to listen (the image: http://+:8080)
/// </summary>
public sealed class KeySettings
{
    /// <summary>The most keys one order line may ask for, so a typo'd quantity can't fill the database.</summary>
    public const int MaxKeysPerItem = 100;

    public required string SigningKey { get; init; }
    public required string WebhookSecret { get; init; }
    public required string PaddleApiKey { get; init; }
    public required string PaddleApi { get; init; }
    public required IReadOnlySet<string> PersonPrices { get; init; }
    public required IReadOnlySet<string> ServerPrices { get; init; }
    public required string Database { get; init; }
    public required string SiteOrigin { get; init; }
    public required MailSettings Mail { get; init; }
    public IReadOnlyList<System.Net.IPNetwork> TrustedProxies { get; init; } = [];

    public sealed record MailSettings(string Host, int Port, string Tls, string? User, string? Password, string From);

    /// <summary>Read from configuration; a missing or broken setting says which, in one line.</summary>
    public static KeySettings From(IConfiguration config)
    {
        var environment = (config["PADDLE_ENVIRONMENT"] ?? "sandbox").Trim().ToLowerInvariant();
        var api = environment switch
        {
            "sandbox" => "https://sandbox-api.paddle.com",
            "live" => "https://api.paddle.com",
            _ => throw new KeySettingsException("PADDLE_ENVIRONMENT must be sandbox or live"),
        };
        var person = Prices(config, "PADDLE_PRICE_PERSON");
        var server = Prices(config, "PADDLE_PRICE_SERVER");
        if (person.Overlaps(server)) throw new KeySettingsException("PADDLE_PRICE_PERSON and PADDLE_PRICE_SERVER share a price id");
        var port = config["SMTP_PORT"] is { Length: > 0 } text
            ? int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) && parsed is > 0 and < 65536
                ? parsed
                : throw new KeySettingsException("SMTP_PORT must be a port number")
            : 587;
        var tls = (config["SMTP_TLS"] ?? "starttls").Trim().ToLowerInvariant();
        if (tls is not ("starttls" or "tls" or "none")) throw new KeySettingsException("SMTP_TLS must be starttls, tls or none");
        var host = Required(config, "SMTP_HOST");
        var user = config["SMTP_USER"] is { Length: > 0 } named ? named : null;
        if (tls == "none" && user is not null && !IsLoopback(host))
        {
            throw new KeySettingsException("SMTP_TLS=none would send the SMTP password unencrypted; use starttls or tls (none is for a relay on this host)");
        }
        return new KeySettings
        {
            SigningKey = Secret(config, "KEYS_SIGNING_KEY_FILE")!,
            WebhookSecret = Secret(config, "PADDLE_WEBHOOK_SECRET_FILE")!,
            PaddleApiKey = Secret(config, "PADDLE_API_KEY_FILE")!,
            PaddleApi = api,
            PersonPrices = person,
            ServerPrices = server,
            Database = config["KEYS_DB"] is { Length: > 0 } db ? db : "/data/keys.db",
            SiteOrigin = (config["KEYS_SITE_ORIGIN"] is { Length: > 0 } origin ? origin : "https://pecklist.com").TrimEnd('/'),
            Mail = new MailSettings(host, port, tls, user, Secret(config, "SMTP_PASSWORD_FILE", required: false), Required(config, "SMTP_FROM")),
            TrustedProxies = Proxies(config),
        };
    }

    private static bool IsLoopback(string host) =>
        host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || (IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address));

    private static List<System.Net.IPNetwork> Proxies(IConfiguration config)
    {
        var networks = new List<System.Net.IPNetwork>();
        foreach (var entry in (config["KEYS_TRUSTED_PROXIES"] ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (System.Net.IPNetwork.TryParse(entry, out var network)) networks.Add(network);
            else if (IPAddress.TryParse(entry, out var address)) networks.Add(new System.Net.IPNetwork(address, address.AddressFamily == AddressFamily.InterNetwork ? 32 : 128));
            else throw new KeySettingsException($"KEYS_TRUSTED_PROXIES must list addresses or networks (192.0.2.10, 192.0.2.0/24), not {entry}");
        }
        return networks;
    }

    private static string Required(IConfiguration config, string name) =>
        config[name] is { Length: > 0 } value ? value.Trim() : throw new KeySettingsException($"{name} is not set");

    private static HashSet<string> Prices(IConfiguration config, string name)
    {
        var prices = Required(config, name).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet(StringComparer.Ordinal);
        if (prices.Count == 0 || prices.Any(price => !price.StartsWith("pri_", StringComparison.Ordinal)))
        {
            throw new KeySettingsException($"{name} must list Paddle price ids (pri_...)");
        }
        return prices;
    }

    private static string? Secret(IConfiguration config, string name, bool required = true)
    {
        if (config[name] is not { Length: > 0 } path) return required ? throw new KeySettingsException($"{name} is not set") : null;
        try
        {
            var value = File.ReadAllText(path).Trim();
            return value.Length > 0 ? value : throw new KeySettingsException($"{name} names an empty file");
        }
        catch (IOException error)
        {
            throw new KeySettingsException($"{name}: could not read {path}: {error.Message}");
        }
        catch (UnauthorizedAccessException)
        {
            throw new KeySettingsException($"{name}: no permission to read {path}");
        }
    }
}

public sealed class KeySettingsException(string message) : Exception(message);
