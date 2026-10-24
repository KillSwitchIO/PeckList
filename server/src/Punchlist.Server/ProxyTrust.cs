using System.Net;

namespace Punchlist.Server;

/// <summary>
/// Which reverse proxies may set X-Forwarded-For and X-Forwarded-Proto (<c>TRUSTED_PROXIES</c>).
/// Default: loopback and the private ranges, which covers a proxy on the same host or in the
/// same Docker network. A comma-separated list of addresses or CIDR ranges replaces it.
/// </summary>
public static class ProxyTrust
{
    public static readonly IReadOnlyList<IPNetwork> PrivateRanges =
    [
        IPNetwork.Parse("127.0.0.0/8"),
        IPNetwork.Parse("10.0.0.0/8"),
        IPNetwork.Parse("172.16.0.0/12"),
        IPNetwork.Parse("192.168.0.0/16"),
        IPNetwork.Parse("::1/128"),
        IPNetwork.Parse("fc00::/7"),
    ];

    /// <summary>Parse <c>TRUSTED_PROXIES</c>; null or blank means the private ranges.</summary>
    public static IReadOnlyList<IPNetwork> Parse(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return PrivateRanges;
        var networks = new List<IPNetwork>();
        foreach (var raw in value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (raw.Contains('/') && IPNetwork.TryParse(raw, out var network))
            {
                networks.Add(network);
            }
            else if (IPAddress.TryParse(raw, out var address))
            {
                networks.Add(new IPNetwork(address, address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork ? 32 : 128));
            }
            else
            {
                throw new FormatException($"TRUSTED_PROXIES: '{raw}' is not an IP address or CIDR range");
            }
        }
        return networks;
    }
}
