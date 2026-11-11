using System.Net;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>Who a per-address limit counts (audit of PL-133): IPv6 by its /64.</summary>
public sealed class AddressKeyTests
{
    [Theory]
    [InlineData("192.0.2.7", "192.0.2.7")]
    [InlineData("::ffff:192.0.2.7", "192.0.2.7")]
    [InlineData("2001:db8:1:2::1", "2001:db8:1:2::/64")]
    [InlineData("2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64")]
    [InlineData("2001:db8:1:3::1", "2001:db8:1:3::/64")]
    [InlineData("::1", "::/64")]
    public void Counts_an_ipv6_address_by_its_64(string address, string key) =>
        Assert.Equal(key, AuthSetup.AddressKey(IPAddress.Parse(address)));

    [Fact]
    public void An_unknown_address_is_one_key() => Assert.Equal("unknown", AuthSetup.AddressKey((IPAddress?)null));
}
