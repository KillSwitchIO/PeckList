using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Sharing;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>The identity provider's picture on a profile (spec: R-FB-62).</summary>
public sealed class ProviderPhotoTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static readonly byte[] Pixel = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    private sealed class Pictures : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var big = request.RequestUri!.AbsolutePath.Contains("big");
            var content = new ByteArrayContent(big ? new byte[ProviderPhoto.MaxBytes + 10] : Pixel);
            content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = content });
        }
    }

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_provider_picture_fills_a_profile_with_none_also_after_one_is_taken_away_but_never_replaces_one()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services =>
                services.AddHttpClient("photos").ConfigurePrimaryHttpMessageHandler(() => new Pictures())));
        var accounts = server.Services.GetRequiredService<AccountService>();
        const string password = "a long enough password";
        var account = await accounts.CreateUserAsync("pat-p", password, mustChangePassword: false, cancellation: Token);
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "pat-p", password }, Token)).EnsureSuccessStatusCode();
        // Any API call writes the profile.
        (await client.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion, cursor = (long?)null }, Token)).EnsureSuccessStatusCode();
        var photos = server.Services.GetRequiredService<ProviderPhoto>();
        var sharing = server.Services.GetRequiredService<SharingState>();
        JsonObject Profile() => sharing.Index.LiveOf("users").Single(each => each.Id == account.Id).Doc;

        // Too big: initials stay.
        await photos.ImportAsync(account.Id, "https://id.example.com/big.png", Token);
        Assert.False(Profile().ContainsKey("photo"));

        await photos.ImportAsync(account.Id, "https://id.example.com/me.png", Token);
        Assert.StartsWith("data:image/png;base64,", (string?)Profile()["photo"]);

        // A photo of one's own stays; taken away, the provider's comes back.
        var mine = (JsonObject)Profile().DeepClone();
        mine["photo"] = "data:image/png;base64,QUJD";
        mine["_hlc"]!["photo"] = $"{DateTime.UtcNow.AddSeconds(5):yyyy-MM-ddTHH:mm:ss.fff}Z-0000-dev1";
        (await client.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[] { new { collection = "users", entity = mine } },
        }, Token)).EnsureSuccessStatusCode();
        await photos.ImportAsync(account.Id, "https://id.example.com/me.png", Token);
        Assert.Equal("data:image/png;base64,QUJD", (string?)Profile()["photo"]);
        var none = (JsonObject)Profile().DeepClone();
        none["photo"] = "";
        none["_hlc"]!["photo"] = $"{DateTime.UtcNow.AddSeconds(6):yyyy-MM-ddTHH:mm:ss.fff}Z-0000-dev1";
        (await client.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new object[] { new { collection = "users", entity = none } },
        }, Token)).EnsureSuccessStatusCode();
        await photos.ImportAsync(account.Id, "https://id.example.com/me.png", Token);
        Assert.StartsWith("data:image/png;base64,iVBOR", (string?)Profile()["photo"]);
    }

    [Fact]
    public async Task The_provider_picture_passes_through_whole_for_the_app_and_is_404_without_one()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services =>
                services.AddHttpClient("photos").ConfigurePrimaryHttpMessageHandler(() => new Pictures())));
        var photos = server.Services.GetRequiredService<ProviderPhoto>();
        // Too big to keep as it is, but the app shrinks it: it comes through whole.
        var big = await photos.FetchAsync("https://id.example.com/big.png", Token);
        Assert.Equal(ProviderPhoto.MaxBytes + 10, big!.Value.Bytes.Length);
        Assert.Equal("image/png", big.Value.Type);

        var accounts = server.Services.GetRequiredService<AccountService>();
        await accounts.CreateUserAsync("pat-q", "a long enough password", mustChangePassword: false, cancellation: Token);
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "pat-q", password = "a long enough password" }, Token)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/account/provider-picture", Token)).StatusCode);
        var me = await client.GetFromJsonAsync<JsonObject>("/auth/me", Token);
        Assert.False((bool)me!["hasProviderPicture"]!);
    }

    /// <summary>Redirects: to the picture, to a file path, or round and round.</summary>
    private sealed class Redirects : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path == "/me.png")
            {
                var content = new ByteArrayContent(Pixel);
                content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = content });
            }
            var to = path switch
            {
                "/moved" => "/me.png",
                "/to-file" => "file:///etc/passwd",
                _ => "/loop",
            };
            var response = new HttpResponseMessage(HttpStatusCode.Found);
            response.Headers.Location = new Uri(to, UriKind.RelativeOrAbsolute);
            return Task.FromResult(response);
        }
    }

    [Fact]
    public async Task Redirects_are_followed_a_few_times_and_only_to_web_addresses()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services =>
                services.AddHttpClient("photos").ConfigurePrimaryHttpMessageHandler(() => new Redirects())));
        var photos = server.Services.GetRequiredService<ProviderPhoto>();
        Assert.Equal(Pixel, (await photos.FetchAsync("https://id.example.com/moved", Token))!.Value.Bytes);
        Assert.Null(await photos.FetchAsync("https://id.example.com/to-file", Token));
        Assert.Null(await photos.FetchAsync("https://id.example.com/loop", Token));
    }

    [Theory]
    [InlineData("127.0.0.1", false)]
    [InlineData("10.1.2.3", false)]
    [InlineData("172.20.0.5", false)]
    [InlineData("192.168.1.10", false)]
    [InlineData("169.254.169.254", false)]
    [InlineData("100.64.0.1", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("::1", false)]
    [InlineData("fd12:3456::1", false)]
    [InlineData("fe80::1", false)]
    [InlineData("::ffff:10.0.0.1", false)]
    [InlineData("93.184.216.34", true)]
    [InlineData("2606:4700::6810:84e5", true)]
    public void Only_public_addresses_count_as_public(string address, bool expected) =>
        Assert.Equal(expected, PhotoAddresses.IsPublic(System.Net.IPAddress.Parse(address)));

    [Fact]
    public async Task Pictures_never_come_from_the_servers_own_network_unless_a_provider_lives_there()
    {
        // A local service the picture claim points at: it must never even be connected to.
        using var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        var port = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
        var accepted = 0;
        _ = Task.Run(async () =>
        {
            while (true)
            {
                using var socket = await listener.AcceptSocketAsync(Token);
                Interlocked.Increment(ref accepted);
                await socket.ReceiveAsync(new byte[4096], Token);
                await socket.SendAsync("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 1\r\nConnection: close\r\n\r\nx"u8.ToArray(), Token);
                socket.Shutdown(System.Net.Sockets.SocketShutdown.Both);
            }
        }, Token);
        var trusted = new List<string>();
        using var client = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, ConnectCallback = PhotoAddresses.Connect(() => trusted) });

        await Assert.ThrowsAsync<HttpRequestException>(() => client.GetAsync($"http://127.0.0.1:{port}/admin", Token));
        Assert.Equal(0, accepted);

        // The self-hoster's own identity provider on the LAN is fine.
        trusted.Add("127.0.0.1");
        using var response = await client.GetAsync($"http://127.0.0.1:{port}/me.png", Token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(1, accepted);
    }
}
