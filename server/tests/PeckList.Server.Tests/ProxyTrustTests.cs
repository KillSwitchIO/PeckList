using System.Net;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

public sealed class ProxyTrustTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void Blank_means_loopback_and_not_every_private_range(string? value)
    {
        // Audit S6: the private ranges trusted everything on the LAN, a VPN or a Docker network.
        var networks = ProxyTrust.Parse(value);
        Assert.Same(ProxyTrust.Loopback, networks);
        Assert.Contains(networks, network => network.Contains(IPAddress.Parse("127.0.0.1")));
        Assert.Contains(networks, network => network.Contains(IPAddress.IPv6Loopback));
        Assert.DoesNotContain(networks, network => network.Contains(IPAddress.Parse("192.168.1.20")));
        Assert.DoesNotContain(networks, network => network.Contains(IPAddress.Parse("10.69.3.11")));
    }

    [Fact]
    public void In_a_container_the_networks_it_is_on_count_too()
    {
        var networks = ProxyTrust.Parse(null, inContainer: true);
        Assert.Contains(networks, network => network.Contains(IPAddress.Parse("127.0.0.1")));
        Assert.Equal([.. ProxyTrust.Loopback, .. ProxyTrust.OwnNetworks()], networks);
        // Never wider than a /8, whatever an interface claims.
        Assert.All(ProxyTrust.OwnNetworks(), network => Assert.True(network.PrefixLength >= 8));
    }

    [Fact]
    public void A_network_is_its_address_with_the_host_bits_cleared()
    {
        Assert.Equal(IPNetwork.Parse("172.18.0.0/16"), ProxyTrust.Network(IPAddress.Parse("172.18.4.7"), 16));
        Assert.Equal(IPNetwork.Parse("10.69.3.0/24"), ProxyTrust.Network(IPAddress.Parse("10.69.3.129"), 24));
        Assert.Equal(IPNetwork.Parse("fd00:1:2::/48"), ProxyTrust.Network(IPAddress.Parse("fd00:1:2:3::9"), 48));
    }

    [Fact]
    public void Takes_addresses_and_ranges()
    {
        var networks = ProxyTrust.Parse("203.0.113.7, 198.51.100.0/24,2001:db8::1");
        Assert.Equal(3, networks.Count);
        Assert.True(networks[0].Contains(IPAddress.Parse("203.0.113.7")));
        Assert.False(networks[0].Contains(IPAddress.Parse("203.0.113.8")));
        Assert.True(networks[1].Contains(IPAddress.Parse("198.51.100.200")));
        Assert.Equal(128, networks[2].PrefixLength);
    }

    [Fact]
    public void Rejects_junk_with_the_variable_name()
    {
        var error = Assert.Throws<FormatException>(() => ProxyTrust.Parse("10.0.0.0/8, proxy.local"));
        Assert.Contains("TRUSTED_PROXIES", error.Message);
        Assert.Contains("proxy.local", error.Message);
    }

    [Fact]
    public void Sign_in_tries_are_limited_per_account_name_whatever_the_address()
    {
        using var attempts = new LoginAttempts();
        for (var i = 0; i < LoginAttempts.PerMinute; i++) Assert.True(attempts.TryTake("Sam"));
        // The eleventh, however the name is written.
        Assert.False(attempts.TryTake(" sam ", out var wait));
        // How long to wait, for the Retry-After header: at most the minute.
        Assert.InRange(wait, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(1));
        Assert.True(attempts.TryTake("alex"));
    }
}
