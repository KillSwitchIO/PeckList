using System.Net;
using System.Net.Sockets;

namespace PeckList.Server.Auth;

/// <summary>
/// Where the server may fetch a provider picture from (audit S2). The <c>picture</c> claim is often
/// set by the person themselves, so it must not make the server reach into its own network (other
/// services, cloud metadata, its own admin routes). Public addresses only, except the hosts of the
/// configured identity providers: a self-hoster's provider on the same LAN serves its pictures from
/// there. The check runs when connecting, on the address actually used, for every redirect too.
/// </summary>
public static class PhotoAddresses
{
    /// <summary>Whether an address is on the public internet (not loopback, private, link-local, ...).</summary>
    public static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (IPAddress.IsLoopback(address) || address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any)) return false;
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = address.GetAddressBytes();
            return !(b[0] == 0 || b[0] == 10 || b[0] == 127 || b[0] >= 224
                || (b[0] == 100 && b[1] >= 64 && b[1] < 128)
                || (b[0] == 169 && b[1] == 254)
                || (b[0] == 172 && b[1] >= 16 && b[1] < 32)
                || (b[0] == 192 && b[1] == 168)
                || (b[0] == 192 && b[1] == 0 && b[2] == 0)
                || (b[0] == 198 && (b[1] == 18 || b[1] == 19)));
        }
        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            var first = address.GetAddressBytes()[0];
            return !(address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6Multicast
                || (first & 0xFE) == 0xFC); // fc00::/7, unique local
        }
        return false;
    }

    /// <summary>A connect step for the picture client that keeps to <see cref="IsPublic"/>.</summary>
    public static Func<SocketsHttpConnectionContext, CancellationToken, ValueTask<Stream>> Connect(Func<IEnumerable<string>> trustedHosts) =>
        async (context, cancellation) =>
        {
            var host = context.DnsEndPoint.Host;
            var trusted = trustedHosts().Contains(host, StringComparer.OrdinalIgnoreCase);
            var addresses = IPAddress.TryParse(host, out var literal) ? [literal] : await Dns.GetHostAddressesAsync(host, cancellation);
            var allowed = addresses.Where(address => trusted || IsPublic(address)).ToArray();
            if (allowed.Length == 0) throw new HttpRequestException($"{host} is not a public address");
            var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(allowed, context.DnsEndPoint.Port, cancellation);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        };
}
