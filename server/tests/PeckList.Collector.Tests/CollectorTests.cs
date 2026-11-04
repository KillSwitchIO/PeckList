using System.Net;
using System.Net.Http.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;
using PeckList.Collector;
using PeckList.Core.Telemetry;
using Testcontainers.PostgreSql;

namespace PeckList.Collector.Tests;

/// <summary>
/// A PostgreSQL server for the tests: the one PECKLIST_TEST_POSTGRES names (CI's service), else a
/// container of its own (Testcontainers; needs Docker).
/// </summary>
public sealed class PostgresServer : IAsyncLifetime
{
    private static readonly string? Given = Environment.GetEnvironmentVariable("PECKLIST_TEST_POSTGRES");
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
    public async Task A_crash_report_is_kept_scrubbed_and_a_malformed_one_refused()
    {
        var (factory, connection) = await StartAsync();
        await using var _ = factory;
        var client = factory.CreateClient();
        var report = new CrashReport
        {
            InstallId = Guid.NewGuid().ToString(), Source = "web", Version = "0.8.0", Channel = "release",
            Kind = "TypeError", Fingerprint = "a1b2c3d4", Stack = "at render (https://tasks.zebra-example.test/assets/index.js:1:2)",
        };
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/public/v1/crash", report, Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/public/v1/crash", report with { Fingerprint = "not hex" }, Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/public/v1/crash", report with { Source = "printer" }, Cancel)).StatusCode);

        await using var db = new NpgsqlConnection(connection);
        var kept = await db.QuerySingleAsync<string>(new CommandDefinition("SELECT payload::text FROM crashes", cancellationToken: Cancel));
        Assert.DoesNotContain("zebra", kept);
        Assert.Contains("/assets/index.js:1:2", kept);
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
        var response = await client.GetAsync("/api/private/v1/stats", Cancel);
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
    public async Task Only_the_report_is_public_the_totals_and_the_health_check_are_private()
    {
        var (factory, _) = await StartAsync();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/private/healthz", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/private/v1/stats", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/public/v1/stats", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/public/", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/healthz", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/v1/ping", Ping(), Cancel)).StatusCode);
    }

    [Fact]
    public async Task The_bare_address_leads_to_a_status_page_for_people()
    {
        var (factory, connection) = await StartAsync();
        var store = Store(connection);
        for (var i = 0; i < 5; i++) await store.SaveAsync(Ping(version: "0.3.0"), DateTimeOffset.UtcNow, Cancel);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var root = await client.GetAsync("/", Cancel);
        Assert.Equal(HttpStatusCode.Redirect, root.StatusCode);
        Assert.Equal("/api/private/", root.Headers.Location?.ToString());

        var page = await client.GetAsync("/api/private/", Cancel);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.Equal("text/html", page.Content.Headers.ContentType?.MediaType);
        var html = await page.Content.ReadAsStringAsync(Cancel);
        Assert.Contains("PeckList telemetry", html);
        Assert.Contains("0.3.0", html);
        Assert.Contains("<div class=\"total\">5</div>", html);
    }

    [Fact]
    public async Task A_schema_3_report_is_kept_with_the_country_cloudflare_names_and_nothing_finer()
    {
        var (factory, connection) = await StartAsync();
        using var client = factory.CreateClient();
        async Task<HttpStatusCode> Send(TelemetryPing ping, string? country)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/public/v1/ping") { Content = JsonContent.Create(ping) };
            if (country is not null) request.Headers.Add("CF-IPCountry", country);
            return (await client.SendAsync(request, Cancel)).StatusCode;
        }

        Assert.Equal(HttpStatusCode.Accepted, await Send(Full(), "DE"));
        // Cloudflare's "unknown" and "Tor", and anything that is not two capitals, keep no country.
        Assert.Equal(HttpStatusCode.Accepted, await Send(Full(), "XX"));
        Assert.Equal(HttpStatusCode.Accepted, await Send(Full(), "T1"));
        Assert.Equal(HttpStatusCode.Accepted, await Send(Full(), "Berlin"));
        Assert.Equal(HttpStatusCode.Accepted, await Send(Full(), null));

        await using var db = new NpgsqlConnection(connection);
        Assert.Equal(new string?[] { "DE", null, null, null, null },
            (await db.QueryAsync<string?>("SELECT country FROM pings ORDER BY received_at")).ToArray());
        var stored = await db.ExecuteScalarAsync<string>("SELECT payload::text FROM pings WHERE country = 'DE'");
        Assert.Contains("\"timeZone\": \"Europe/Berlin\"", stored);
        Assert.Contains("\"tasks\": \"101-500\"", stored);

        // A name off the lists, or a value that is not a bucket, is refused.
        Assert.Equal(HttpStatusCode.BadRequest, await Send(Full() with { Rows = new Dictionary<string, string> { ["secrets"] = "1" } }, null));
        Assert.Equal(HttpStatusCode.BadRequest, await Send(Full() with { Host = Full().Host! with { TimeZone = "Ben's house" } }, null));
        Assert.Equal(HttpStatusCode.BadRequest, await Send(Full() with { Setup = Full().Setup with { Email = "smtp.example.com" } }, null));
    }

    [Fact]
    public async Task The_public_totals_break_down_by_country_and_machine()
    {
        var (_, connection) = await StartAsync();
        var store = Store(connection);
        for (var i = 0; i < 5; i++) await store.SaveAsync(Full(), Now, Cancel, "US");

        var stats = await store.StatsAsync(Now, Cancel);
        Assert.Equal([new StatValue("US", 5)], stats.Breakdown["country"]);
        Assert.Equal([new StatValue("Europe/Berlin", 5)], stats.Breakdown["timeZone"]);
        Assert.Equal([new StatValue("5-8", 5)], stats.Breakdown["cpus"]);
        Assert.Equal([new StatValue("gmail", 5)], stats.Breakdown["email"]);
    }

    [Fact]
    public async Task Dashboards_get_a_role_that_reads_everything_and_changes_nothing()
    {
        var connection = await server.NewDatabaseAsync();
        var file = Path.GetTempFileName();
        await File.WriteAllTextAsync(file, "it's a reader password\n", Cancel);
        try
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(host => host
                .UseSetting("COLLECTOR_DB", connection)
                .UseSetting("COLLECTOR_READER_PASSWORD_FILE", file));
            using var client = factory.CreateClient();
            Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/public/v1/ping", Ping(), Cancel)).StatusCode);

            var reader = new NpgsqlConnectionStringBuilder(connection) { Username = PingStore.ReaderRole, Password = "it's a reader password" };
            await using var db = new NpgsqlConnection(reader.ToString());
            Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT count(*) FROM pings"));
            Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT count(*) FROM daily_totals"));
            var refused = await Assert.ThrowsAsync<PostgresException>(() => db.ExecuteAsync("DELETE FROM pings"));
            Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, refused.SqlState);
        }
        finally
        {
            File.Delete(file);
        }
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

    /// <summary>A schema 3 report, with everything it may carry.</summary>
    private static TelemetryPing Full() => Ping("0.8.0") with
    {
        Setup = new TelemetrySetup(true, false, 1, "invite", "daily", true, "0", false,
            Email: "gmail", Passkeys: true, HttpsAddress: true, BehindProxy: true, LogOutputs: ["file", "loki"], CrashReports: true,
            OidcPresets: ["google"], Demo: false),
        Host = new TelemetryHost("5-8", "4-8GB", "100-250MB", "1-5%", "7-30d", "6.12", "docker", "Europe/Berlin"),
        Storage = new TelemetryStorage("1-10MB", "10-100MB", "100MB-1GB", "1-10MB", "100GB-1TB"),
        Rows = new Dictionary<string, string> { ["tasks"] = "101-500", ["lists"] = "6-20", ["passkeys"] = "1" },
    };
}
