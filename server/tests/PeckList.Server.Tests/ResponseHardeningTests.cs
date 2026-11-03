using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace PeckList.Server.Tests;

/// <summary>The headers and compression the server sends itself, so a plain proxy is enough.</summary>
public sealed class ResponseHardeningTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string Password = "correct horse battery";
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("/")]
    [InlineData("/today")]
    [InlineData("/api/info")]
    [InlineData("/api/nope")]
    public async Task Every_answer_carries_the_browser_protections(string path)
    {
        using var server = fixture.Factory();
        var response = await server.CreateClient().GetAsync(path, Token);
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("same-origin", response.Headers.GetValues("Referrer-Policy").Single());
        var policy = response.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("script-src 'self';", policy);
        Assert.DoesNotContain("unsafe-eval", policy);
        Assert.Contains("frame-ancestors 'none'", policy);
    }

    [Theory]
    [InlineData("https://tasks.example.com", true)]
    [InlineData("http://tasks.example.com", false)]
    [InlineData("https://localhost", false)]
    public async Task Hsts_only_over_https_and_never_for_localhost(string address, bool sent)
    {
        using var server = fixture.Factory();
        var client = server.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri(address) });
        var response = await client.GetAsync("/", Token);
        Assert.Equal(sent, response.Headers.Contains("Strict-Transport-Security"));
        if (sent) Assert.Equal("max-age=31536000", response.Headers.GetValues("Strict-Transport-Security").Single());
    }

    [Theory]
    [InlineData("/assets/index-abc123.js", "br")]
    [InlineData("/", "gzip")]
    [InlineData("/api/info", "br")]
    public async Task Compresses_for_browsers_that_ask(string path, string encoding)
    {
        using var server = fixture.Factory();
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("Accept-Encoding", encoding);
        var response = await server.CreateClient().SendAsync(request, Token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal([encoding], response.Content.Headers.ContentEncoding);

        // A client that does not ask gets it plain.
        var plain = await server.CreateClient().GetAsync(path, Token);
        Assert.Empty(plain.Content.Headers.ContentEncoding);
    }

    [Theory]
    [InlineData("br", "br", "brotli copy")]
    [InlineData("gzip", "gzip", "gzip copy")]
    [InlineData("br;q=0, gzip", "gzip", "gzip copy")]
    public async Task Sends_the_builds_precompressed_copy(string accept, string encoding, string body)
    {
        // The build writes app.js.br and app.js.gz next to app.js (web/precompress.ts).
        var assets = Path.Combine(fixture.WebRoot, "assets");
        File.WriteAllText(Path.Combine(assets, "app-def456.js"), "console.log('plain')");
        File.WriteAllText(Path.Combine(assets, "app-def456.js.br"), "brotli copy");
        File.WriteAllText(Path.Combine(assets, "app-def456.js.gz"), "gzip copy");
        using var server = fixture.Factory();
        var request = new HttpRequestMessage(HttpMethod.Get, "/assets/app-def456.js");
        request.Headers.Add("Accept-Encoding", accept);
        var response = await server.CreateClient().SendAsync(request, Token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal([encoding], response.Content.Headers.ContentEncoding);
        Assert.Equal("text/javascript", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("Accept-Encoding", response.Headers.Vary);
        Assert.Equal("public, max-age=31536000, immutable", response.Headers.CacheControl?.ToString());
        // Sent as it is, not compressed again on the way.
        Assert.Equal(body, await response.Content.ReadAsStringAsync(Token));

        var plain = await server.CreateClient().GetAsync("/assets/app-def456.js", Token);
        Assert.Empty(plain.Content.Headers.ContentEncoding);
        Assert.Equal("console.log('plain')", await plain.Content.ReadAsStringAsync(Token));
    }

    [Fact]
    public async Task Live_updates_are_never_compressed_or_held_back()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", Password));
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = Password }, Token)).EnsureSuccessStatusCode();
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/events");
        request.Headers.Add("Accept-Encoding", "br, gzip");
        using var events = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, Token);
        Assert.Empty(events.Content.Headers.ContentEncoding);
        using var reader = new StreamReader(await events.Content.ReadAsStreamAsync(Token));
        // Held back by a compressing or buffering layer, the first line would not come.
        using var patience = CancellationTokenSource.CreateLinkedTokenSource(Token);
        patience.CancelAfter(TimeSpan.FromSeconds(5));
        Assert.Equal(": connected", await reader.ReadLineAsync(patience.Token));
    }
}
