using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core.Storage;
using Punchlist.Storage.Sql;

namespace Punchlist.Server.Tests;

/// <summary>The server listens while its sharing index loads (audit P3), instead of nothing answering until it is done.</summary>
public sealed class StartupTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    /// <summary>A store whose full read (the index load) waits until the test lets it go.</summary>
    private sealed class HeldStore(IEntityStore inner, Task release) : IEntityStore
    {
        public Task<long> CursorAsync(CancellationToken cancellation = default) => inner.CursorAsync(cancellation);
        public Task<StoredEntity?> GetAsync(string id, CancellationToken cancellation = default) => inner.GetAsync(id, cancellation);
        public Task<IReadOnlyList<StoredEntity>> WriteAsync(string ownerId, IReadOnlyList<IncomingEntity> incoming,
            Func<StoredEntity?, IncomingEntity, JsonObject?> resolve, Func<IReadOnlyList<StoredEntity>, VisibilityPlan>? plan = null,
            CancellationToken cancellation = default) => inner.WriteAsync(ownerId, incoming, resolve, plan, cancellation);
        public Task ApplyVisibilityAsync(VisibilityPlan plan, CancellationToken cancellation = default) => inner.ApplyVisibilityAsync(plan, cancellation);
        public Task<ChangePage> ChangesAsync(string userId, long after, int limit, CancellationToken cancellation = default) =>
            inner.ChangesAsync(userId, after, limit, cancellation);
        public IAsyncEnumerable<(string UserId, string EntityId)> VisibilityAsync(CancellationToken cancellation = default) => inner.VisibilityAsync(cancellation);
        public Task RestoreAsync(IReadOnlyList<StoredEntity> entities, IReadOnlyList<(string UserId, string EntityId)> visibility, long cursor,
            CancellationToken cancellation = default) => inner.RestoreAsync(entities, visibility, cursor, cancellation);

        public async IAsyncEnumerable<StoredEntity> AllAsync([EnumeratorCancellation] CancellationToken cancellation = default)
        {
            await release.WaitAsync(cancellation);
            await foreach (var entity in inner.AllAsync(cancellation)) yield return entity;
        }
    }

    [Fact]
    public async Task While_the_sharing_index_loads_the_server_answers_and_says_it_is_starting()
    {
        var release = new TaskCompletionSource();
        using var server = fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"), ("DB_PATH", fixture.NewDbPath()))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services =>
            {
                services.AddSingleton(new StartupWait(TimeSpan.FromMilliseconds(200)));
                services.AddSingleton<IEntityStore>(provider =>
                    new HeldStore(ActivatorUtilities.CreateInstance<SqlEntityStore>(provider), release.Task));
            }));
        var client = server.CreateClient();

        // Up at once: its info, and a health check that passes while it says what it is doing.
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/info", Token)).StatusCode);
        var health = await client.GetAsync("/healthz", Token);
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);
        Assert.Equal("Degraded", await health.Content.ReadAsStringAsync(Token));
        // Anything that needs the index waits a little, then says to come back.
        var early = await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = "correct horse battery" }, Token);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, early.StatusCode);
        Assert.Equal("starting", (string?)(await early.Content.ReadFromJsonAsync<JsonObject>(Token))!["error"]);
        Assert.NotNull(early.Headers.RetryAfter);

        release.SetResult();
        var healthy = "";
        for (var tries = 0; tries < 100 && healthy != "Healthy"; tries++)
        {
            healthy = await (await client.GetAsync("/healthz", Token)).Content.ReadAsStringAsync(Token);
            if (healthy != "Healthy") await Task.Delay(50, Token);
        }
        Assert.Equal("Healthy", healthy);
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = "correct horse battery" }, Token)).EnsureSuccessStatusCode();
    }
}
