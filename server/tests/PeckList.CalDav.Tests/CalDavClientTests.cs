using System.Net;
using System.Text;
using PeckList.CalDav.Dav;

namespace PeckList.CalDav.Tests;

/// <summary>
/// The client's rules that a well-behaved server never exercises: redirects, addresses on other
/// hosts and the failures the engine switches on. Each runs against a scripted fake server.
/// </summary>
public sealed class CalDavClientTests
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    /// <summary>Answers each request with the first rule that matches, and records what was asked.</summary>
    internal sealed class FakeServer : HttpMessageHandler
    {
        private readonly List<(Func<HttpRequestMessage, string?, bool> When, Func<HttpRequestMessage, HttpResponseMessage> Answer)> rules = [];

        public List<HttpRequestMessage> Requests { get; } = [];

        /// <summary>The request bodies, read as they arrive (the client disposes them after sending).</summary>
        public List<string?> Bodies { get; } = [];

        /// <summary>Answers a method on an address; with <paramref name="bodyHas"/>, only when the body holds that text.</summary>
        public FakeServer On(string method, string url, Func<HttpRequestMessage, HttpResponseMessage> answer, string? bodyHas = null)
        {
            rules.Add(((r, body) => r.Method.Method == method && r.RequestUri!.ToString() == url
                && (bodyHas is null || (body?.Contains(bodyHas, StringComparison.Ordinal) ?? false)), answer));
            return this;
        }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            Bodies.Add(body);
            var rule = rules.FirstOrDefault(r => r.When(request, body));
            return rule.Answer?.Invoke(request) ?? new HttpResponseMessage(HttpStatusCode.NotFound);
        }
    }

    private static HttpResponseMessage Redirect(string to, HttpStatusCode status = HttpStatusCode.MovedPermanently)
    {
        var response = new HttpResponseMessage(status);
        response.Headers.Location = new Uri(to, UriKind.RelativeOrAbsolute);
        return response;
    }

    internal static HttpResponseMessage Multistatus(string responses) =>
        new((HttpStatusCode)207) { Content = new StringContent($"<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\">{responses}</d:multistatus>", Encoding.UTF8, "application/xml") };

    private static HttpResponseMessage Principal(string href, string principal) =>
        Multistatus($"<d:response><d:href>{href}</d:href><d:propstat><d:prop><d:current-user-principal><d:href>{principal}</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>");

    private static HttpResponseMessage Home(string href, string home) =>
        Multistatus($"<d:response><d:href>{href}</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>{home}</d:href></c:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>");

    private static CalDavClient Client(FakeServer server) => new(new HttpClient(server), new CalDavCredentials("ben", "app-password"));

    [Fact]
    public async Task Follows_a_well_known_redirect_to_another_host_while_discovering()
    {
        // iCloud's shape: the well-known address sends each account to a host of its own.
        var server = new FakeServer()
            .On("PROPFIND", "https://caldav.example.com/.well-known/caldav", _ => Redirect("https://p12-caldav.example.com/"))
            .On("PROPFIND", "https://p12-caldav.example.com/", _ => Principal("/", "/1234/principal/"))
            .On("PROPFIND", "https://p12-caldav.example.com/1234/principal/", _ => Home("/1234/principal/", "https://p12-caldav.example.com:443/1234/calendars/"));

        var account = await Client(server).DiscoverAsync("caldav.example.com", Token);

        Assert.Equal(new Uri("https://p12-caldav.example.com/1234/principal/"), account.Principal);
        Assert.Equal(new Uri("https://p12-caldav.example.com/1234/calendars/"), account.Home);
        Assert.All(server.Requests, r => Assert.Equal("Basic", r.Headers.Authorization!.Scheme));
    }

    [Fact]
    public async Task Tries_the_root_when_the_server_has_no_well_known_address()
    {
        var server = new FakeServer()
            .On("PROPFIND", "https://dav.example.com/", _ => Principal("/", "/principals/ben/"))
            .On("PROPFIND", "https://dav.example.com/principals/ben/", _ => Home("/principals/ben/", "/calendars/ben/"));

        var account = await Client(server).DiscoverAsync("https://dav.example.com", Token);

        Assert.Equal(new Uri("https://dav.example.com/calendars/ben/"), account.Home);
    }

    [Fact]
    public async Task Never_follows_a_redirect_from_https_to_http()
    {
        var server = new FakeServer()
            .On("PROPFIND", "https://caldav.example.com/.well-known/caldav", _ => Redirect("http://caldav.example.com/dav/"));

        var refused = await Assert.ThrowsAsync<CalDavException>(() => Client(server).DiscoverAsync("caldav.example.com", Token));

        Assert.Equal(CalDavFailure.Blocked, refused.Failure);
        Assert.Single(server.Requests);
    }

    [Fact]
    public async Task Sends_the_password_to_a_new_host_only_over_https()
    {
        var server = new FakeServer()
            .On("PROPFIND", "http://caldav.lan/.well-known/caldav", _ => Redirect("http://other.lan/dav/"));

        var refused = await Assert.ThrowsAsync<CalDavException>(() => Client(server).DiscoverAsync("http://caldav.lan", Token));

        Assert.Equal(CalDavFailure.Blocked, refused.Failure);
        Assert.DoesNotContain(server.Requests, r => r.RequestUri!.Host == "other.lan");
    }

    [Theory]
    [InlineData("http://10.0.0.1/principal/", null)]
    [InlineData("/principal/", "http://10.0.0.1/calendars/")]
    public async Task Discovery_follows_the_servers_hrefs_by_the_redirect_rules(string principal, string? home)
    {
        var server = new FakeServer()
            .On("PROPFIND", "https://dav.example.com/dav/", _ => Principal("/dav/", principal))
            .On("PROPFIND", "https://dav.example.com/principal/", _ => Home("/principal/", home ?? "/calendars/"));

        var refused = await Assert.ThrowsAsync<CalDavException>(() => Client(server).DiscoverAsync("https://dav.example.com/dav/", Token));

        Assert.Equal(CalDavFailure.Blocked, refused.Failure);
        Assert.DoesNotContain(server.Requests, r => r.RequestUri!.Host == "10.0.0.1");
    }

    /// <summary>A body that gives one byte a second, for as long as it's read.</summary>
    private sealed class TrickleStream : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
            buffer.Span[0] = (byte)' ';
            return 1;
        }
    }

    [Fact]
    public async Task Gives_up_on_an_answer_that_trickles_in_once_the_deadline_passes()
    {
        var server = new FakeServer().On("REPORT", "https://dav.example.com/cal/", _ =>
            new HttpResponseMessage((HttpStatusCode)207) { Content = new StreamContent(new TrickleStream()) });
        var client = new CalDavClient(new HttpClient(server), new CalDavCredentials("ben", "app-password")) { RequestTimeout = TimeSpan.FromSeconds(2) };
        var clock = System.Diagnostics.Stopwatch.StartNew();

        var refused = await Assert.ThrowsAsync<CalDavException>(() => client.ChangesAsync(new Uri("https://dav.example.com/cal/"), "t1", Token));

        Assert.Equal(CalDavFailure.RetryLater, refused.Failure);
        Assert.InRange(clock.Elapsed, TimeSpan.FromSeconds(1.5), TimeSpan.FromSeconds(10));
    }

    [Fact]
    public async Task Gives_up_after_five_redirects()
    {
        var server = new FakeServer();
        for (var i = 0; i < 10; i++)
        {
            var next = $"/{i + 1}";
            server.On("PROPFIND", $"https://dav.example.com/{i}", _ => Redirect(next));
        }
        server.On("PROPFIND", "https://dav.example.com/", _ => Redirect("/0"));

        var refused = await Assert.ThrowsAsync<CalDavException>(() => Client(server).DiscoverAsync("https://dav.example.com/0", Token));

        Assert.Equal(CalDavFailure.NotCalDav, refused.Failure);
        Assert.True(server.Requests.Count <= 5);
    }

    [Fact]
    public async Task Refuses_a_redirect_to_another_host_once_past_discovery()
    {
        var server = new FakeServer()
            .On("PUT", "https://dav.example.com/cal/a.ics", _ => Redirect("https://elsewhere.example.net/a.ics", HttpStatusCode.TemporaryRedirect));

        var refused = await Assert.ThrowsAsync<CalDavException>(() =>
            Client(server).CreateAsync(new Uri("https://dav.example.com/cal/"), "a.ics", "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", Token));

        Assert.Equal(CalDavFailure.Rejected, refused.Failure);
        Assert.DoesNotContain(server.Requests, r => r.RequestUri!.Host == "elsewhere.example.net");
    }

    [Fact]
    public async Task Ignores_changes_the_server_lists_on_another_host()
    {
        var server = new FakeServer().On("REPORT", "https://dav.example.com/cal/", _ => Multistatus(
            "<d:response><d:href>/cal/mine.ics</d:href><d:propstat><d:prop><d:getetag>\"1\"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>" +
            "<d:response><d:href>https://elsewhere.example.net/steal.ics</d:href><d:propstat><d:prop><d:getetag>\"2\"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>" +
            "<d:sync-token>t2</d:sync-token>"));

        var changes = await Client(server).ChangesAsync(new Uri("https://dav.example.com/cal/"), "t1", Token);

        Assert.Equal([new DavEtag(new Uri("https://dav.example.com/cal/mine.ics"), "\"1\"")], changes.Changed);
        Assert.Equal("t2", changes.Token);
    }

    [Fact]
    public async Task Follows_a_truncated_sync_answer_until_the_server_has_sent_everything()
    {
        var answers = new Queue<HttpResponseMessage>([
            Multistatus("<d:response><d:href>/cal/a.ics</d:href><d:propstat><d:prop><d:getetag>\"1\"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>" +
                "<d:response><d:href>/cal/</d:href><d:status>HTTP/1.1 507 Insufficient Storage</d:status></d:response><d:sync-token>t2</d:sync-token>"),
            Multistatus("<d:response><d:href>/cal/b.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response><d:sync-token>t3</d:sync-token>"),
        ]);
        var server = new FakeServer().On("REPORT", "https://dav.example.com/cal/", _ => answers.Dequeue());

        var changes = await Client(server).ChangesAsync(new Uri("https://dav.example.com/cal/"), "t1", Token);

        Assert.Equal(["/cal/a.ics"], changes.Changed.Select(c => c.Href.AbsolutePath));
        Assert.Equal(["/cal/b.ics"], changes.Removed.Select(h => h.AbsolutePath));
        Assert.Equal("t3", changes.Token);
        Assert.Contains("<d:sync-token>t2</d:sync-token>", server.Bodies[1], StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, CalDavFailure.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden, CalDavFailure.Forbidden)]
    [InlineData(HttpStatusCode.Gone, CalDavFailure.NotFound)]
    [InlineData(HttpStatusCode.PreconditionFailed, CalDavFailure.Conflict)]
    [InlineData(HttpStatusCode.RequestEntityTooLarge, CalDavFailure.Rejected)]
    [InlineData(HttpStatusCode.InternalServerError, CalDavFailure.RetryLater)]
    public async Task Names_each_kind_of_failure(HttpStatusCode status, CalDavFailure failure)
    {
        var server = new FakeServer().On("PUT", "https://dav.example.com/cal/a.ics", _ => new HttpResponseMessage(status));

        var refused = await Assert.ThrowsAsync<CalDavException>(() =>
            Client(server).UpdateAsync(new Uri("https://dav.example.com/cal/a.ics"), "\"1\"", "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", Token));

        Assert.Equal(failure, refused.Failure);
        Assert.Equal((int)status, refused.Status);
    }

    [Fact]
    public async Task Passes_on_how_long_a_busy_server_asks_to_wait()
    {
        var server = new FakeServer().On("REPORT", "https://dav.example.com/cal/", _ =>
        {
            var busy = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            busy.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromSeconds(120));
            return busy;
        });

        var refused = await Assert.ThrowsAsync<CalDavException>(() => Client(server).ChangesAsync(new Uri("https://dav.example.com/cal/"), null, Token));

        Assert.Equal(CalDavFailure.RetryLater, refused.Failure);
        Assert.Equal(TimeSpan.FromSeconds(120), refused.RetryAfter);
    }

    [Fact]
    public async Task Reads_the_etag_back_when_a_server_answers_a_PUT_without_one()
    {
        var server = new FakeServer()
            .On("PUT", "https://dav.example.com/cal/a.ics", _ => new HttpResponseMessage(HttpStatusCode.Created))
            .On("PROPFIND", "https://dav.example.com/cal/a.ics", _ => Multistatus(
                "<d:response><d:href>/cal/a.ics</d:href><d:propstat><d:prop><d:getetag>rewritten</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"));

        var created = await Client(server).CreateAsync(new Uri("https://dav.example.com/cal"), "a.ics", "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", Token);

        Assert.Equal("\"rewritten\"", created.ETag);
        Assert.Equal("*", server.Requests[0].Headers.IfNoneMatch.Single().Tag);
    }

    [Theory]
    [InlineData("../escape.ics")]
    [InlineData("a/b.ics")]
    [InlineData("no-extension")]
    public async Task Refuses_a_resource_name_that_could_point_elsewhere(string name)
    {
        await Assert.ThrowsAsync<ArgumentException>(() =>
            Client(new FakeServer()).CreateAsync(new Uri("https://dav.example.com/cal/"), name, "x", Token));
    }

    [Theory]
    [InlineData("ftp://dav.example.com/")]
    [InlineData("https://user:secret@dav.example.com/")]
    [InlineData("not a url at all")]
    public async Task Refuses_an_address_that_is_not_a_web_server(string address)
    {
        var refused = await Assert.ThrowsAsync<CalDavException>(() => Client(new FakeServer()).DiscoverAsync(address, Token));

        Assert.Equal(CalDavFailure.Rejected, refused.Failure);
    }
}
