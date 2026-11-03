using System.Net;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core.Configuration;

namespace Punchlist.Server.Tests;

/// <summary>The OpenAPI document and the Swagger UI page (spec: PL-118).</summary>
public sealed class ApiDocsTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Document(HttpClient client)
    {
        var response = await client.GetAsync(ApiDocs.DocumentPath, Token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Token));
        return json.RootElement.Clone();
    }

    [Fact]
    public async Task The_document_describes_the_api_and_nothing_else()
    {
        using var server = fixture.Factory(("DB_PATH", fixture.NewDbPath()));
        var document = await Document(server.CreateClient());

        Assert.StartsWith("3.", document.GetProperty("openapi").GetString());
        Assert.Equal("PeckList API", document.GetProperty("info").GetProperty("title").GetString());
        Assert.Equal(ServerApp.Version, document.GetProperty("info").GetProperty("version").GetString());
        var paths = document.GetProperty("paths").EnumerateObject().Select(each => each.Name).ToList();
        Assert.Contains("/api/sync", paths);
        Assert.Contains("/api/info", paths);
        Assert.Contains(paths, path => path.StartsWith("/api/admin/", StringComparison.Ordinal));
        // Sign-in pages, provider callbacks and the web app's fallback are not the API.
        Assert.All(paths, path => Assert.StartsWith("/api/", path));
        var tags = document.GetProperty("tags").EnumerateArray().Select(each => each.GetProperty("name").GetString()).ToList();
        Assert.Contains("Sync", tags);
        Assert.Contains("Admin: users", tags);
        Assert.DoesNotContain("punchlist", tags);
    }

    [Theory]
    [InlineData("api/friends/code", "Friends")]
    [InlineData("api/attachments/{sha256}", "Attachments")]
    [InlineData("api/admin/settings/{key}", "Admin: settings")]
    [InlineData("api/admin/users/{id}/hand-over", "Admin: users")]
    [InlineData("api/admin/audit.csv", "Admin: audit")]
    public void Operations_group_by_area(string path, string area) => Assert.Equal(area, ApiDocs.Area(path));

    [Fact]
    public async Task Api_keys_are_the_documented_way_in()
    {
        using var server = fixture.Factory(("DB_PATH", fixture.NewDbPath()));
        var document = await Document(server.CreateClient());

        var scheme = document.GetProperty("components").GetProperty("securitySchemes").GetProperty(ApiDocs.KeyScheme);
        Assert.Equal("http", scheme.GetProperty("type").GetString());
        Assert.Equal("bearer", scheme.GetProperty("scheme").GetString());
        var required = document.GetProperty("security").EnumerateArray().Single();
        Assert.True(required.TryGetProperty(ApiDocs.KeyScheme, out _));
    }

    [Fact]
    public async Task The_page_reads_the_document_from_beside_it()
    {
        using var server = fixture.Factory(("DB_PATH", fixture.NewDbPath()));
        var client = server.CreateClient();

        var page = await client.GetAsync($"{ApiDocs.PagePath}/index.html", Token);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.Contains("swagger-ui", await page.Content.ReadAsStringAsync(Token));
        var config = await client.GetStringAsync($"{ApiDocs.PagePath}/index.js", Token);
        Assert.Contains("../openapi/v1.json", config);
        // The page lives under the server's own strict policy: its scripts are files, never inline.
        Assert.Contains("script-src 'self';", page.Headers.GetValues("Content-Security-Policy").Single());
    }

    [Fact]
    public async Task Turned_off_both_are_gone_and_the_switch_is_live()
    {
        using var server = fixture.Factory(("DB_PATH", fixture.NewDbPath()), ("API_DOCS", "off"));
        var client = server.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(ApiDocs.DocumentPath, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{ApiDocs.PagePath}/index.html", Token)).StatusCode);

        var live = server.Services.GetRequiredService<LiveSettings>();
        live.Apply(live.Current with { ApiDocs = true });
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(ApiDocs.DocumentPath, Token)).StatusCode);
    }
}
