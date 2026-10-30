using System.Net;
using System.Net.Http.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;
using Punchlist.Collector;
using Punchlist.Core.Telemetry;
using Testcontainers.PostgreSql;

namespace Punchlist.Collector.Tests;

/// <summary>
/// A PostgreSQL server for the tests: the one PUNCHLIST_TEST_POSTGRES names (CI's service), else a
/// container of its own (Testcontainers; needs Docker).
/// </summary>
public sealed class PostgresServer : IAsyncLifetime
{
    private static readonly string? Given = Environment.GetEnvironmentVariable("PUNCHLIST_TEST_POSTGRES");
    private readonly PostgreSqlContainer? container = string.IsNullOrEmpty(Given) ? new PostgreSqlBuilder("postgres:15-alpine").Build() : null;

    public async ValueTask InitializeAsync()
    {
        if (container is not null) await container.StartAsync();
    }

    public async ValueTask DisposeAsync()
    {
        if (container is not null) await container.DisposeAsync();
    }

    /// <summary>The connection string of a new, empty database.</summary>
    public async Task<string> NewDatabaseAsync()
    {
        var server = container?.GetConnectionString() ?? Given!;
        var name = $"collector_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(server))
        {
            await admin.OpenAsync(TestContext.Current.CancellationToken);
            await admin.ExecuteAsync($"CREATE DATABASE {name}");
        }
        return new NpgsqlConnectionStringBuilder(server) { Database = name }.ToString();
    }
}

public sealed class CollectorTests(PostgresServer server) : IClassFixture<PostgresServer>
{
    private static readonly DateTimeOffset Now = new(2026, 10, 30, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task A_server_counts_once_a_day_however_often_it_pings()
    {
        var (factory, connection) = await StartAsync();
        using var client = factory.CreateClient();
        var ping = Ping();

        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/public/v1/ping", ping, Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/public/v1/ping", ping with { Version = "0.3.1" }, Cancel)).StatusCode);

        await using var db = new NpgsqlConnection(connection);
        var rows = (await db.QueryAsync<(string Version, string Channel)>("SELECT version, channel FROM pings")).ToList();
        Assert.Equal(new[] { ("0.3.1", "release") }, rows);
    }

    [Fact]
    public async Task Pings_that_are_not_the_expected_shape_are_refused_and_not_kept()
    {
        var (factory, connection) = await StartAsync();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/public/v1/ping", Ping() with { Channel = "nightly" }, Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/public/v1/ping", Ping() with { InstallId = "ben's-server" }, Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/public/v1/ping", new { schema = 1, installId = Guid.NewGuid() }, Cancel)).StatusCode);
        var huge = new StringContent(new string('x', 100_000), System.Text.Encoding.UTF8, "application/json");
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await client.PostAsync("/api/public/v1/ping", huge, Cancel)).StatusCode);

        await using var db = new NpgsqlConnection(connection);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT count(*) FROM pings"));
    }

    [Fact]
    public async Task A_field_the_collector_does_not_know_is_not_kept()
    {
        var (factory, connection) = await StartAsync();
        using var client = factory.CreateClient();
        var ping = Ping();
        var body = new
        {
            ping.Schema, ping.InstallId, ping.Version, ping.Channel, ping.InstallAgeDays, ping.Runtime, ping.Setup, ping.Scale,
            hostname = "tasks.example.com",
        };

        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/public/v1/ping", body, Cancel)).StatusCode);

        await using var db = new NpgsqlConnection(connection);
        var stored = await db.ExecuteScalarAsync<string>("SELECT payload::text FROM pings");
        Assert.DoesNotContain("example.com", stored);
    }

    [Fact]
    public async Task The_public_totals_fold_values_fewer_than_five_installs_share()
    {
        var (factory, connection) = await StartAsync();
        var store = Store(connection);
        for (var i = 0; i < 6; i++) await store.SaveAsync(Ping(version: "0.3.0"), Now, Cancel);
        for (var i = 0; i < 3; i++) await store.SaveAsync(Ping(version: "0.2.9"), Now, Cancel);

        var stats = await store.StatsAsync(Now, Cancel);
        Assert.Equal(9, stats.Installs);
        Assert.Equal(new[] { new StatValue("0.3.0", 6) }, stats.Breakdown["version"]);

        for (var i = 0; i < 2; i++) await store.SaveAsync(Ping(version: "0.2.8"), Now, Cancel);
        stats = await store.StatsAsync(Now, Cancel);
        Assert.Equal(new[] { new StatValue("0.3.0", 6), new StatValue("other", 5) }, stats.Breakdown["version"]);

        using var client = factory.CreateClient();
        var response = await client.GetAsync("/api/public/v1/stats", Cancel);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"installs\":11", await response.Content.ReadAsStringAsync(Cancel));
    }

    [Fact]
    public async Task Finished_days_are_totalled_once_and_pings_older_than_90_days_go()
    {
        var (_, connection) = await StartAsync();
        var store = Store(connection);
        var today = DateOnly.FromDateTime(Now.UtcDateTime);
        await store.SaveAsync(Ping(), Now.AddDays(-100), Cancel);
        await store.SaveAsync(Ping(), Now.AddDays(-1), Cancel);
        await store.SaveAsync(Ping(), Now, Cancel);

        await store.TotalAndPruneAsync(today, Cancel);
        await store.TotalAndPruneAsync(today, Cancel);

        await using var db = new NpgsqlConnection(connection);
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT count(*) FROM pings"));
        var totals = (await db.QueryAsync<(DateTime Day, int Installs)>(
            "SELECT day, installs FROM daily_totals WHERE dimension = 'version' ORDER BY day")).ToList();
        Assert.Equal(
            new[] { (Now.AddDays(-100).UtcDateTime.Date, 1), (Now.AddDays(-1).UtcDateTime.Date, 1) },
            totals);
    }

    [Fact]
    public async Task Only_the_report_and_the_totals_are_public_the_health_check_is_private()
    {
        var (factory, _) = await StartAsync();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/private/healthz", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/public/v1/stats", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/healthz", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/v1/ping", Ping(), Cancel)).StatusCode);
    }

    [Fact]
    public async Task The_database_password_can_come_from_a_file()
    {
        var connection = await server.NewDatabaseAsync();
        var builder = new NpgsqlConnectionStringBuilder(connection);
        var file = Path.GetTempFileName();
        await File.WriteAllTextAsync(file, builder.Password + "\n", Cancel);
        builder.Password = null;
        try
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(host => host
                .UseSetting("COLLECTOR_DB", builder.ToString())
                .UseSetting("COLLECTOR_DB_PASSWORD_FILE", file));
            using var client = factory.CreateClient();
            Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/public/v1/ping", Ping(), Cancel)).StatusCode);
        }
        finally
        {
            File.Delete(file);
        }
    }

    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private async Task<(WebApplicationFactory<Program> Factory, string Connection)> StartAsync()
    {
        var connection = await server.NewDatabaseAsync();
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(host => host.UseSetting("COLLECTOR_DB", connection));
        // Starting the host runs the schema.
        _ = factory.Server;
        return (factory, connection);
    }

    private static PingStore Store(string connection) => new(NpgsqlDataSource.Create(connection));

    private static TelemetryPing Ping(string version = "0.3.0") => new()
    {
        InstallId = Guid.NewGuid().ToString(),
        Version = version,
        Channel = TelemetryBuckets.ChannelOf(version),
        InstallAgeDays = 12,
        Runtime = new TelemetryRuntime("linux", "x64", true, "10.0.0", "sqlite", "1-10MB"),
        Setup = new TelemetrySetup(true, false, 1, "invite", "daily", true, "0", false),
        Scale = new TelemetryScale("2-5", "6-20", "1", "21-100", "101-500", "1-10MB"),
    };
}
