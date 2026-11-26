using System.Net;
using System.Net.Sockets;

namespace PeckList.CalDav.Dav;

/// <summary>
/// Which addresses the server may reach for a CalDAV account. A person types the server address,
/// so on a server several people share, an open client would let anyone make the server probe its
/// own network (SSRF). Private, loopback and link-local addresses are refused unless the admin
/// allows them for a calendar server on their own network, and plain <c>http://</c> only ever
/// goes to such an address, so a password never crosses the internet unencrypted.
/// </summary>
/// <param name="allowPrivateNetwork">
/// Whether private, loopback and link-local addresses (and plain http to them) are allowed, asked on
/// every new connection so a changed server setting applies without a restart.
/// </param>
public sealed class CalDavNetworkPolicy(Func<bool> allowPrivateNetwork)
{
    /// <summary>A policy with a fixed answer.</summary>
    public CalDavNetworkPolicy(bool allowPrivateNetwork) : this(() => allowPrivateNetwork)
    {
    }

    /// <summary>Whether private network addresses are allowed right now.</summary>
    public bool AllowPrivateNetwork => allowPrivateNetwork();

    /// <summary>
    /// The handler every CalDAV request goes through: no automatic redirects (the client follows
    /// them itself, see <see cref="CalDavClient"/>), no proxy (a proxy would hide the address the
    /// check must see), and the address check on every new connection, after DNS.
    /// </summary>
    public SocketsHttpHandler CreateHandler() => new()
    {
        AllowAutoRedirect = false,
        UseProxy = false,
        UseCookies = false,
        AutomaticDecompression = DecompressionMethods.All,
        ConnectTimeout = TimeSpan.FromSeconds(15),
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        ConnectCallback = ConnectAsync,
    };

    private async ValueTask<Stream> ConnectAsync(SocketsHttpConnectionContext context, CancellationToken cancellationToken)
    {
        var secure = context.InitialRequestMessage.RequestUri?.Scheme == Uri.UriSchemeHttps;
        var host = context.DnsEndPoint.Host;
        var addresses = IPAddress.TryParse(host, out var literal)
            ? [literal]
            : await Dns.GetHostAddressesAsync(host, cancellationToken).ConfigureAwait(false);
        var allowed = addresses.Where(a => Allows(a, secure)).ToArray();
        if (allowed.Length == 0) throw new CalDavBlockedException(host, addresses.Length > 0 && addresses.All(IsPublic) && !secure);
        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(allowed, context.DnsEndPoint.Port, cancellationToken).ConfigureAwait(false);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    /// <summary>Whether a connection to <paramref name="address"/> may be made.</summary>
    public bool Allows(IPAddress address, bool secure) =>
        IsPublic(address) ? secure : AllowPrivateNetwork && !IsNeverReachable(address);

    // Addresses no calendar server lives at, refused even when private networks are allowed.
    private static bool IsNeverReachable(IPAddress address)
    {
        var a = address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
        if (a.Equals(IPAddress.Any) || a.Equals(IPAddress.IPv6Any) || a.Equals(IPAddress.Broadcast)) return true;
        if (a.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = a.GetAddressBytes();
            return b[0] >= 224                    // multicast and reserved
                || (b[0] == 169 && b[1] == 254);  // link-local: cloud metadata, never a calendar server
        }
        return a.IsIPv6Multicast || a.IsIPv6LinkLocal;
    }

    /// <summary>
    /// True for an address on the public internet: not loopback, private (RFC 1918, RFC 4193),
    /// shared (RFC 6598), link-local, multicast, documentation or otherwise reserved.
    /// </summary>
    public static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (IPAddress.IsLoopback(address)) return false;
        var b = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return !(b[0] == 0 || b[0] == 10 || b[0] == 127 || b[0] >= 224
                || (b[0] == 100 && b[1] >= 64 && b[1] <= 127)   // 100.64.0.0/10, shared (CGNAT, Tailscale)
                || (b[0] == 169 && b[1] == 254)                 // link-local, cloud metadata
                || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                || (b[0] == 192 && b[1] == 168)
                || (b[0] == 192 && b[1] == 0 && (b[2] == 0 || b[2] == 2))
                || (b[0] == 198 && (b[1] == 18 || b[1] == 19))
                || (b[0] == 198 && b[1] == 51 && b[2] == 100)
                || (b[0] == 203 && b[1] == 0 && b[2] == 113));
        }
        if (address.AddressFamily != AddressFamily.InterNetworkV6) return false;
        if (address.Equals(IPAddress.IPv6Any) || address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6Multicast) return false;
        if ((b[0] & 0xfe) == 0xfc) return false;                          // fc00::/7, unique local
        if (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8) return false; // documentation
        if (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0 && b[3] == 0) return false;       // 2001::/32, Teredo
        if (b[0] == 0 && b[1] == 0x64 && b[2] == 0xff && b[3] == 0x9b && b[4] == 0 && b[5] == 1) return false; // 64:ff9b:1::/48, local-use NAT64
        // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) carry an IPv4 address: judge that one.
        if (b[0] == 0 && b[1] == 0x64 && b[2] == 0xff && b[3] == 0x9b && b.AsSpan(4, 8).IndexOfAnyExcept((byte)0) < 0)
            return IsPublic(new IPAddress(b.AsSpan(12, 4)));
        if (b[0] == 0x20 && b[1] == 0x02) return IsPublic(new IPAddress(b.AsSpan(2, 4)));
        return b.AsSpan(0, 10).IndexOfAnyExcept((byte)0) >= 0;           // ::/80 (IPv4-compatible and the rest) is not
    }
}

/// <summary>A connection the <see cref="CalDavNetworkPolicy"/> refused.</summary>
public sealed class CalDavBlockedException(string host, bool insecure)
    : IOException(insecure ? $"{host}: plain http is only allowed to a private network address" : $"{host}: private network addresses are not allowed")
{
    /// <summary>The host that was refused.</summary>
    public string Host { get; } = host;

    /// <summary>True when the address was public but the request was plain http.</summary>
    public bool Insecure { get; } = insecure;
}
