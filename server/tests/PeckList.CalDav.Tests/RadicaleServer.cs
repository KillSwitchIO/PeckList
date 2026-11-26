using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using PeckList.CalDav.Dav;

[assembly: AssemblyFixture(typeof(PeckList.CalDav.Tests.RadicaleServer))]

namespace PeckList.CalDav.Tests;

/// <summary>
/// A Radicale CalDAV server for the tests (spec: PL-134, CalDAV is tested against Radicale): the
/// one <c>PECKLIST_TEST_CALDAV</c> names (CI's service), else a container of its own
/// (Testcontainers; needs Docker). Radicale runs with <c>auth = none</c>, so any username signs in
/// and gets an empty account of its own: each test takes a fresh one and shares nothing.
/// </summary>
public sealed class RadicaleServer : IAsyncLifetime
{
    /// <summary>The image, pinned; CI's service in .gitlab-ci.yml names the same one.</summary>
    public const string Image = "tomsquest/docker-radicale:3.9.0.0";

    private static readonly string? Given = Environment.GetEnvironmentVariable("PECKLIST_TEST_CALDAV");
    private IContainer? container;

    /// <summary>The server's root address.</summary>
    public Uri Url { get; private set; } = null!;

    public async ValueTask InitializeAsync()
    {
        if (!string.IsNullOrEmpty(Given))
        {
            Url = new Uri(Given);
            await WaitUntilUpAsync(Url);
            return;
        }
        container = new ContainerBuilder(Image)
            .WithPortBinding(5232, assignRandomHostPort: true)
            .WithLabel("pecklist.owner", Environment.GetEnvironmentVariable("PECKLIST_DOCKER_OWNER") ?? "tests")
            .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(r => r.ForPort(5232).ForPath("/.web/")))
            .Build();
        await container.StartAsync();
        Url = new UriBuilder(Uri.UriSchemeHttp, container.Hostname, container.GetMappedPublicPort(5232)).Uri;
    }

    // A service started beside the tests (CI's, or a dev's) may still be starting: the first
    // requests would meet a closed connection.
    private static async Task WaitUntilUpAsync(Uri url)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        var until = DateTime.UtcNow.AddSeconds(60);
        while (true)
        {
            try
            {
                using var answer = await http.GetAsync(new Uri(url, ".web/"));
                if (answer.IsSuccessStatusCode) return;
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && DateTime.UtcNow < until)
            {
                // Not listening yet.
            }
            if (DateTime.UtcNow >= until) throw new InvalidOperationException($"no CalDAV server answered at {url}");
            await Task.Delay(250);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (container is not null) await container.DisposeAsync();
    }

    /// <summary>A username nobody else uses, so its account starts empty.</summary>
    public static string NewUser() => "u" + Guid.NewGuid().ToString("N")[..12];

    /// <summary>
    /// A client signed in as <paramref name="user"/>. Radicale runs on a private address, so the
    /// policy allows those unless <paramref name="allowPrivateNetwork"/> says otherwise.
    /// </summary>
    public static CalDavClient Client(string user, bool allowPrivateNetwork = true) =>
        new(new HttpClient(new CalDavNetworkPolicy(allowPrivateNetwork).CreateHandler()) { Timeout = TimeSpan.FromSeconds(30) },
            new CalDavCredentials(user, "app-password"));

    /// <summary>A fresh account with one empty event calendar, and a client signed in to it.</summary>
    public async Task<(CalDavClient Client, DavAccount Account, DavCalendar Calendar)> NewCalendarAsync(string name = "Work")
    {
        var client = Client(NewUser());
        var account = await client.DiscoverAsync(Url.ToString(), TestContext.Current.CancellationToken);
        var calendar = await client.MakeCalendarAsync(account.Home, name, TestContext.Current.CancellationToken);
        return (client, account, calendar);
    }
}
