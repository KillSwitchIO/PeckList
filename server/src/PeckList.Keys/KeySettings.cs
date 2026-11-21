using System.Globalization;
using System.Net;
using System.Net.Sockets;

namespace PeckList.Keys;

/// <summary>
/// The service's settings, from the environment. Secrets come from files (<c>*_FILE</c>), so they
/// stay out of the environment and out of <c>docker inspect</c>:
///   KEYS_SIGNING_KEY_FILE       the Ed25519 private key, base64 of the raw 32 bytes (made by
///                               <c>pecklist-keys generate-signing-key</c>; required)
/// Paddle (card payments), set up when PADDLE_WEBHOOK_SECRET_FILE is set:
///   PADDLE_WEBHOOK_SECRET_FILE  the notification destination's secret key
///   PADDLE_API_KEY_FILE         an API key with customer.read, to look up who to email
///   PADDLE_ENVIRONMENT          sandbox (the default) or live
///   PADDLE_API_URL              another address for Paddle's API (a stand-in, for tests); overrides PADDLE_ENVIRONMENT
///   PADDLE_PRICE_PERSON         the price ids of the one-person key, comma-separated
///   PADDLE_PRICE_SERVER         the price ids of the server key, comma-separated
/// BTCPay Server (Bitcoin), set up when BTCPAY_URL is set:
///   BTCPAY_URL                  the BTCPay server, https://btcpay.example.com
///   BTCPAY_STORE_ID             the store the supporter items are sold in
///   BTCPAY_WEBHOOK_SECRET_FILE  the store webhook's secret
///   BTCPAY_API_KEY_FILE         a Greenfield API key with btcpay.store.canviewinvoices, to read paid invoices
///   BTCPAY_ITEM_PERSON          the item codes of the one-person key, comma-separated
///   BTCPAY_ITEM_SERVER          the item codes of the server key, comma-separated
///   BTCPAY_CURRENCY             the currency of the store's prices (USD)
///   BTCPAY_PRICE_PERSON, BTCPAY_PRICE_SERVER  each key's price in it: an invoice paying less gets no key
/// At least one of Paddle and BTCPay must be set up; both may be.
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
    /// <summary>Paddle, when set up.</summary>
    public PaddleSettings? Paddle { get; init; }
    /// <summary>BTCPay Server, when set up.</summary>
    public BtcPaySettings? BtcPay { get; init; }
    public required string Database { get; init; }
    public required string SiteOrigin { get; init; }
    public required MailSettings Mail { get; init; }
    public IReadOnlyList<System.Net.IPNetwork> TrustedProxies { get; init; } = [];

    public sealed record PaddleSettings(string WebhookSecret, string ApiKey, string Api, IReadOnlySet<string> PersonPrices, IReadOnlySet<string> ServerPrices);

    public sealed record BtcPaySettings(
        string Url, string StoreId, string WebhookSecret, string ApiKey,
        IReadOnlySet<string> PersonItems, IReadOnlySet<string> ServerItems,
        string Currency, decimal PersonPrice, decimal ServerPrice);

    public sealed record MailSettings(string Host, int Port, string Tls, string? User, string? Password, string From);

    /// <summary>Read from configuration; a missing or broken setting says which, in one line.</summary>
    public static KeySettings From(IConfiguration config)
    {
        var paddle = config["PADDLE_WEBHOOK_SECRET_FILE"] is { Length: > 0 } ? PaddleFrom(config) : null;
        var btcpay = config["BTCPAY_URL"] is { Length: > 0 } ? BtcPayFrom(config) : null;
        if (paddle is null && btcpay is null)
        {
            throw new KeySettingsException("set up Paddle (PADDLE_WEBHOOK_SECRET_FILE and the rest) or BTCPay (BTCPAY_URL and the rest), or both");
        }
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
            Paddle = paddle,
            BtcPay = btcpay,
            Database = config["KEYS_DB"] is { Length: > 0 } db ? db : "/data/keys.db",
            SiteOrigin = (config["KEYS_SITE_ORIGIN"] is { Length: > 0 } origin ? origin : "https://pecklist.com").TrimEnd('/'),
            Mail = new MailSettings(host, port, tls, user, Secret(config, "SMTP_PASSWORD_FILE", required: false), Required(config, "SMTP_FROM")),
            TrustedProxies = Proxies(config),
        };
    }

    private static PaddleSettings PaddleFrom(IConfiguration config)
    {
        var environment = (config["PADDLE_ENVIRONMENT"] ?? "sandbox").Trim().ToLowerInvariant();
        var api = environment switch
        {
            "sandbox" => "https://sandbox-api.paddle.com",
            "live" => "https://api.paddle.com",
            _ => throw new KeySettingsException("PADDLE_ENVIRONMENT must be sandbox or live"),
        };
        if (config["PADDLE_API_URL"] is { Length: > 0 } standIn) api = Address(standIn, "PADDLE_API_URL");
        static bool IsPrice(string code) => code.StartsWith("pri_", StringComparison.Ordinal);
        var person = Codes(config, "PADDLE_PRICE_PERSON", "Paddle price ids (pri_...)", IsPrice);
        var server = Codes(config, "PADDLE_PRICE_SERVER", "Paddle price ids (pri_...)", IsPrice);
        if (person.Overlaps(server)) throw new KeySettingsException("PADDLE_PRICE_PERSON and PADDLE_PRICE_SERVER share a price id");
        return new PaddleSettings(Secret(config, "PADDLE_WEBHOOK_SECRET_FILE")!, Secret(config, "PADDLE_API_KEY_FILE")!, api, person, server);
    }

    private static BtcPaySettings BtcPayFrom(IConfiguration config)
    {
        var person = Codes(config, "BTCPAY_ITEM_PERSON", "item codes", _ => true);
        var server = Codes(config, "BTCPAY_ITEM_SERVER", "item codes", _ => true);
        if (person.Overlaps(server)) throw new KeySettingsException("BTCPAY_ITEM_PERSON and BTCPAY_ITEM_SERVER share an item code");
        var currency = Required(config, "BTCPAY_CURRENCY").ToUpperInvariant();
        if (currency.Length is < 3 or > 5 || !currency.All(char.IsAsciiLetterUpper)) throw new KeySettingsException("BTCPAY_CURRENCY must be a currency code (USD)");
        return new BtcPaySettings(
            Address(Required(config, "BTCPAY_URL"), "BTCPAY_URL"),
            Required(config, "BTCPAY_STORE_ID"),
            Secret(config, "BTCPAY_WEBHOOK_SECRET_FILE")!,
            Secret(config, "BTCPAY_API_KEY_FILE")!,
            person, server, currency,
            Price(config, "BTCPAY_PRICE_PERSON"), Price(config, "BTCPAY_PRICE_SERVER"));
    }

    private static string Address(string value, string name) =>
        Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http"
            ? uri.ToString().TrimEnd('/')
            : throw new KeySettingsException($"{name} must be an http(s) address");

    private static decimal Price(IConfiguration config, string name) =>
        decimal.TryParse(Required(config, name), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var price) && price > 0
            ? price
            : throw new KeySettingsException($"{name} must be a price above 0 (5 or 5.00)");

    private static bool IsLoopback(string host) =>
        host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || (IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address));

    /// <summary>
    /// The provider API settings whose API key would cross a network unencrypted: http to a host
    /// beyond this machine and its private networks. The service still starts (a stand-in or a
    /// tunnel may be meant), but says so at start.
    /// </summary>
    public IReadOnlyList<string> CleartextApis()
    {
        var found = new List<string>();
        if (Paddle is { } paddle && SendsKeyInClear(paddle.Api)) found.Add("PADDLE_API_URL");
        if (BtcPay is { } btcpay && SendsKeyInClear(btcpay.Url)) found.Add("BTCPAY_URL");
        return found;
    }

    /// <summary>Whether a request to <paramref name="address"/> carries its credentials unencrypted beyond this machine and its private networks.</summary>
    public static bool SendsKeyInClear(string address) =>
        Uri.TryCreate(address, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttp && !IsPrivateHost(uri.Host);

    private static readonly string[] LocalSuffixes = [".internal", ".local", ".lan", ".home.arpa", ".localhost"];

    private static bool IsPrivateHost(string host)
    {
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return true;
        if (IPAddress.TryParse(host.Trim('[', ']'), out var address))
        {
            if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
            if (IPAddress.IsLoopback(address)) return true;
            if (address.AddressFamily == AddressFamily.InterNetworkV6) return address.IsIPv6LinkLocal || address.IsIPv6UniqueLocal;
            var b = address.GetAddressBytes();
            return b[0] == 10 || (b[0] == 172 && b[1] is >= 16 and <= 31) || (b[0] == 192 && b[1] == 168)
                || (b[0] == 169 && b[1] == 254) || (b[0] == 100 && b[1] is >= 64 and <= 127);
        }
        // A name without a dot is a container or host on this network (http://btcpay:49392), and so
        // are names under the suffixes that never leave one.
        return !host.Contains('.') || LocalSuffixes.Any(suffix => host.EndsWith(suffix, StringComparison.OrdinalIgnoreCase));
    }

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

    private static HashSet<string> Codes(IConfiguration config, string name, string what, Func<string, bool> valid)
    {
        var codes = Required(config, name).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet(StringComparer.Ordinal);
        if (codes.Count == 0 || !codes.All(valid)) throw new KeySettingsException($"{name} must list {what}");
        return codes;
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
