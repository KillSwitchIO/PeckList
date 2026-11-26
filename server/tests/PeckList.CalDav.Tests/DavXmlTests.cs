using System.Net;
using System.Xml;
using PeckList.CalDav.Dav;
using static PeckList.CalDav.Dav.DavXml;

namespace PeckList.CalDav.Tests;

public sealed class DavXmlTests
{
    // The shape iCloud answers a calendar home PROPFIND in: default namespace, propstats split by status.
    private const string HomeAnswer = """
        <?xml version="1.0" encoding="UTF-8"?>
        <multistatus xmlns="DAV:">
          <response>
            <href>/123456/calendars/home/</href>
            <propstat>
              <prop>
                <resourcetype xmlns="DAV:"><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype>
                <displayname>Home</displayname>
                <calendar-color xmlns="http://apple.com/ns/ical/">#1BADF8FF</calendar-color>
              </prop>
              <status>HTTP/1.1 200 OK</status>
            </propstat>
            <propstat>
              <prop><sync-token/></prop>
              <status>HTTP/1.1 404 Not Found</status>
            </propstat>
          </response>
          <response>
            <href>/123456/calendars/removed.ics</href>
            <status>HTTP/1.1 404 Not Found</status>
          </response>
          <sync-token>https://example.com/sync/42</sync-token>
        </multistatus>
        """;

    [Fact]
    public void Reads_responses_their_propstats_and_the_sync_token()
    {
        var status = Multistatus(HomeAnswer);

        Assert.Equal(2, status.Responses.Count);
        var home = status.Responses[0];
        Assert.Equal("/123456/calendars/home/", home.Href);
        Assert.Equal("Home", home.OkText(D + "displayname"));
        Assert.Equal("#1BADF8FF", home.OkText(A + "calendar-color"));
        Assert.NotNull(home.Ok(D + "resourcetype")!.Element(C + "calendar"));
        Assert.Null(home.Ok(D + "sync-token"));
        Assert.Equal(404, status.Responses[1].Status);
        Assert.Equal("https://example.com/sync/42", status.SyncToken);
    }

    [Fact]
    public void Refuses_a_DTD_so_entities_cannot_reach_files()
    {
        const string evil = """
            <?xml version="1.0"?>
            <!DOCTYPE m [<!ENTITY x SYSTEM "file:///etc/passwd">]>
            <multistatus xmlns="DAV:"><response><href>&x;</href></response></multistatus>
            """;

        Assert.Throws<XmlException>(() => Multistatus(evil));
    }

    [Fact]
    public void Refuses_an_answer_that_is_not_a_multistatus()
    {
        Assert.Throws<XmlException>(() => Multistatus("<error xmlns=\"DAV:\"/>"));
    }

    [Fact]
    public void Recognises_the_invalid_sync_token_precondition()
    {
        Assert.True(IsInvalidSyncToken("<?xml version='1.0'?><error xmlns=\"DAV:\"><valid-sync-token /></error>"));
        Assert.False(IsInvalidSyncToken("<error xmlns=\"DAV:\"><need-privileges/></error>"));
        Assert.False(IsInvalidSyncToken("Forbidden"));
    }

    [Theory]
    [InlineData("HTTP/1.1 200 OK", 200)]
    [InlineData("HTTP/1.1 507 Insufficient Storage", 507)]
    [InlineData("nonsense", null)]
    public void Reads_status_lines(string line, int? code)
    {
        Assert.Equal(code, Status(line));
    }

    [Fact]
    public void Quotes_etags_the_way_If_Match_needs_them()
    {
        Assert.Equal("\"abc\"", CalDavClient.ETag("abc"));
        Assert.Equal("\"abc\"", CalDavClient.ETag(" \"abc\" "));
        Assert.Equal("W/\"abc\"", CalDavClient.ETag("W/\"abc\""));
    }

    [Fact]
    public void Never_prints_the_password()
    {
        Assert.DoesNotContain("hunter2", new CalDavCredentials("ben", "hunter2").ToString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("8.8.8.8", true)]
    [InlineData("17.253.144.10", true)]
    [InlineData("2606:4700::1111", true)]
    [InlineData("127.0.0.1", false)]
    [InlineData("10.1.2.3", false)]
    [InlineData("172.16.0.1", false)]
    [InlineData("172.31.255.1", false)]
    [InlineData("172.32.0.1", true)]
    [InlineData("192.168.1.10", false)]
    [InlineData("100.100.1.1", false)]
    [InlineData("169.254.169.254", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("224.0.0.1", false)]
    [InlineData("::1", false)]
    [InlineData("fd12:3456::1", false)]
    [InlineData("fe80::1", false)]
    [InlineData("::ffff:10.0.0.1", false)]
    [InlineData("::ffff:8.8.8.8", true)]
    [InlineData("64:ff9b::a00:1", false)]
    [InlineData("2002:0a00:0001::1", false)]
    [InlineData("2001:db8::1", false)]
    [InlineData("2001:0:4136:e378::1", false)]   // Teredo
    [InlineData("64:ff9b:1::a00:1", false)]      // local-use NAT64
    [InlineData("2001:4860:4860::8888", true)]
    public void Tells_public_addresses_from_private_ones(string address, bool isPublic)
    {
        Assert.Equal(isPublic, CalDavNetworkPolicy.IsPublic(IPAddress.Parse(address)));
    }

    [Fact]
    public void Refuses_an_answer_with_too_many_nodes()
    {
        var empty = new System.Text.StringBuilder("<d:multistatus xmlns:d=\"DAV:\">");
        while (empty.Length < 30_000_000) empty.Append("<d:x/>");
        var text = empty.Append("</d:multistatus>").ToString();

        Assert.Throws<XmlException>(() => Multistatus(text));
    }

    [Theory]
    [InlineData(false, "8.8.8.8", true, true)]
    [InlineData(false, "8.8.8.8", false, false)]   // plain http over the internet: never
    [InlineData(true, "8.8.8.8", false, false)]
    [InlineData(false, "192.168.1.10", true, false)]
    [InlineData(true, "192.168.1.10", true, true)]
    [InlineData(true, "192.168.1.10", false, true)] // http to a server on your own network, when allowed
    [InlineData(true, "224.0.0.1", true, false)]
    [InlineData(true, "169.254.169.254", true, false)] // link-local (cloud metadata): never, whatever the setting
    [InlineData(true, "fe80::1", true, false)]
    public void Allows_private_addresses_and_plain_http_only_as_the_policy_says(bool allowPrivate, string address, bool secure, bool allowed)
    {
        Assert.Equal(allowed, new CalDavNetworkPolicy(allowPrivate).Allows(IPAddress.Parse(address), secure));
    }
}
