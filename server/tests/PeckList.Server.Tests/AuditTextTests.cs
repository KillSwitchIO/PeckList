using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Audit;
using PeckList.Server.Audit;

namespace PeckList.Server.Tests;

/// <summary>
/// Text reaches the audit log as whole characters, through a real server and PostgreSQL. Runs where
/// <c>PECKLIST_TEST_POSTGRES</c> names a server (CI does).
/// </summary>
public sealed class AuditTextTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string Emoji = "\U0001F426";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private async Task<(WebApplicationFactory<Program> Server, Uri Address)> RealServer()
    {
        var given = Environment.GetEnvironmentVariable("PECKLIST_TEST_POSTGRES");
        Assert.SkipWhen(string.IsNullOrEmpty(given), "needs PECKLIST_TEST_POSTGRES");
        var name = $"test_{Guid.NewGuid():N}";
        await using (var admin = new Npgsql.NpgsqlConnection(given))
        {
            await admin.OpenAsync(Token);
            await using var create = new Npgsql.NpgsqlCommand($"CREATE DATABASE {name}", admin);
            await create.ExecuteNonQueryAsync(Token);
        }
        var server = fixture.Factory(
            ("DB_PROVIDER", "postgres"),
            ("DB_CONNECTION_STRING", new Npgsql.NpgsqlConnectionStringBuilder(given) { Database = name }.ToString()),
            ("ADMIN_PASSWORD", "correct horse battery"));
        server.UseKestrel(0);
        server.StartServer();
        var address = server.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
        return (server, new UriBuilder(address) { Host = "localhost" }.Uri);
    }

    /// <summary>A request written by hand, so the header arrives exactly as it is here.</summary>
    private static async Task<string> Send(Uri address, string agent)
    {
        using var client = new TcpClient();
        await client.ConnectAsync(address.Host, address.Port, Token);
        var stream = client.GetStream();
        var request = $"GET /api/info HTTP/1.1\r\nHost: {address.Authority}\r\nUser-Agent: {agent}\r\nConnection: close\r\n\r\n";
        await stream.WriteAsync(Encoding.UTF8.GetBytes(request), Token);
        using var reader = new StreamReader(stream);
        return await reader.ReadToEndAsync(Token);
    }

    private static async Task<IReadOnlyList<AuditEntry>> Entries(WebApplicationFactory<Program> server, string kind)
    {
        // A request is recorded as its pipeline unwinds, just after the answer reaches the client.
        await Task.Delay(200, Token);
        await server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        return (await server.Services.GetRequiredService<IAuditStore>().QueryAsync(new AuditQuery { Kind = kind, Ascending = true }, Token)).Entries;
    }

    [Fact]
    public async Task A_long_user_agent_is_kept_in_whole_characters()
    {
        var (server, address) = await RealServer();
        using (server)
        {
            Assert.Contains(" 200 ", await Send(address, new string('x', 199) + Emoji + "more"));
            Assert.Contains(" 200 ", await Send(address, "plain"));

            var devices = (await Entries(server, AuditKind.Access)).Where(each => each.Route == "/api/info").Select(each => each.Device).ToList();
            Assert.Contains("plain", devices);
            Assert.Contains(new string('x', 199), devices);
        }
    }

    [Fact]
    public async Task A_long_username_is_kept_in_whole_characters()
    {
        var (server, address) = await RealServer();
        using (server)
        {
            using var client = new HttpClient { BaseAddress = address };
            await client.PostAsJsonAsync("/auth/login", new { username = new string('x', 99) + Emoji, password = "not it at all" }, Token);
            await client.PostAsJsonAsync("/auth/login", new { username = "plain", password = "not it at all" }, Token);

            var names = (await Entries(server, AuditKind.Event)).Where(each => each.Type == "auth.sign-in").Select(each => each.TargetName).ToList();
            Assert.Contains("plain", names);
            Assert.Contains(new string('x', 99), names);
        }
    }

    [Fact]
    public async Task Typed_names_are_recorded_as_clean_text()
    {
        var (server, address) = await RealServer();
        using (server)
        {
            using var client = new HttpClient { BaseAddress = address };
            Task<HttpResponseMessage> Post(string path, string json) => client.PostAsync(path, new StringContent(json, Encoding.UTF8, "application/json"), Token);

            Assert.Equal(System.Net.HttpStatusCode.Unauthorized, (await Post("/auth/login", """{"username":"sa\u0000m","password":"not it at all"}""")).StatusCode);
            Assert.True((int)(await Post("/auth/signup", """{"username":"al\u0000ex","password":"not it at all"}""")).StatusCode < 500);
            Assert.True((int)(await Post("/auth/forgot", """{"login":"ro\u0000bin"}""")).StatusCode < 500);
            await client.PostAsJsonAsync("/auth/login", new { username = "plain", password = "not it at all" }, Token);

            var names = (await Entries(server, AuditKind.Event)).Select(each => each.TargetName).ToList();
            Assert.Contains("plain", names);
            Assert.Contains("sam", names);
            Assert.Contains("alex", names);
            Assert.Contains("robin", names);
        }
    }
}
