using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace PeckList.Server;

/// <summary>
/// Which reverse proxies may set X-Forwarded-For and X-Forwarded-Proto (<c>TRUSTED_PROXIES</c>).
/// Default (audit S6): loopback, and in a container the networks the container is on, which
/// covers a proxy on the same host or in the same Docker network without believing every machine
/// on every private range. A comma-separated list of addresses or CIDR ranges replaces it.
/// </summary>
public static class ProxyTrust
{
    /// <summary>Forwarded hops believed at most, walking back from the nearest proxy.</summary>
    public const int ForwardLimit = 3;

    public static readonly IReadOnlyList<IPNetwork> Loopback =
    [
        IPNetwork.Parse("127.0.0.0/8"),
        IPNetwork.Parse("::1/128"),
    ];

    /// <summary>Loopback, plus in a container the networks it is attached to.</summary>
    public static IReadOnlyList<IPNetwork> Default(bool inContainer) => inContainer ? [.. Loopback, .. OwnNetworks()] : Loopback;

    /// <summary>The networks this machine's interfaces are on (not loopback or link-local).</summary>
    public static IReadOnlyList<IPNetwork> OwnNetworks()
    {
        var networks = new List<IPNetwork>();
        try
        {
            foreach (var face in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (face.OperationalStatus != OperationalStatus.Up || face.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                foreach (var unicast in face.GetIPProperties().UnicastAddresses)
                {
                    var address = unicast.Address;
                    if (IPAddress.IsLoopback(address) || address.IsIPv6LinkLocal) continue;
                    var prefix = unicast.PrefixLength;
                    var full = address.AddressFamily == AddressFamily.InterNetwork ? 32 : 128;
                    // Never a range wider than a /8 (or /32 for IPv6), whatever an interface claims.
                    if (prefix < (full == 32 ? 8 : 32) || prefix > full) continue;
                    var network = Network(address, prefix);
                    if (!networks.Contains(network)) networks.Add(network);
                }
            }
        }
        catch (NetworkInformationException)
        {
            // Nothing to add: loopback alone.
        }
        return networks;
    }

    /// <summary>Parse <c>TRUSTED_PROXIES</c>; null or blank means <see cref="Default"/>.</summary>
    public static IReadOnlyList<IPNetwork> Parse(string? value, bool inContainer = false)
    {
        if (string.IsNullOrWhiteSpace(value)) return Default(inContainer);
        var networks = new List<IPNetwork>();
        foreach (var raw in value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (raw.Contains('/') && IPNetwork.TryParse(raw, out var network))
            {
                networks.Add(network);
            }
            else if (IPAddress.TryParse(raw, out var address))
            {
                networks.Add(new IPNetwork(address, address.AddressFamily == AddressFamily.InterNetwork ? 32 : 128));
            }
            else
            {
                throw new FormatException($"TRUSTED_PROXIES: '{raw}' is not an IP address or CIDR range");
            }
        }
        return networks;
    }

    /// <summary>The network <paramref name="address"/> is in, with its host bits cleared.</summary>
    public static IPNetwork Network(IPAddress address, int prefix)
    {
        var bytes = address.GetAddressBytes();
        for (var bit = prefix; bit < bytes.Length * 8; bit++) bytes[bit / 8] &= (byte)~(0x80 >> (bit % 8));
        return new IPNetwork(new IPAddress(bytes), prefix);
    }
}
