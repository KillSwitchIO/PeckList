using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core;
using Punchlist.Core.Accounts;
using Punchlist.Core.Sharing;
using Punchlist.Server.Auth;

namespace Punchlist.Server.Tests;

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
}
