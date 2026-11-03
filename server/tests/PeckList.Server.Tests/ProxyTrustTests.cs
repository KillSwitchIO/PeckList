using System.Net;

namespace PeckList.Server.Tests;

public sealed class ProxyTrustTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void Blank_means_the_private_ranges(string? value)
    {
        Assert.Same(ProxyTrust.PrivateRanges, ProxyTrust.Parse(value));
        Assert.Contains(ProxyTrust.PrivateRanges, network => network.Contains(IPAddress.Parse("172.18.0.5")));
        Assert.DoesNotContain(ProxyTrust.PrivateRanges, network => network.Contains(IPAddress.Parse("8.8.8.8")));
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
}
