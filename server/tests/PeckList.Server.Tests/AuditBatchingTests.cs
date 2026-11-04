using System.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using PeckList.Core.Audit;
using PeckList.Server.Audit;

namespace PeckList.Server.Tests;

/// <summary>The access log's writer gathers entries so one app exchange is one database write (PL-095).</summary>
public sealed class AuditBatchingTests
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private sealed class CountingStore : IAuditStore
    {
        public List<int> Writes { get; } = [];

        public Task AppendAsync(IReadOnlyList<AuditEntry> entries, CancellationToken cancellation = default)
        {
            lock (Writes) Writes.Add(entries.Count);
            return Task.CompletedTask;
        }

        public Task<AuditPage> QueryAsync(AuditQuery query, CancellationToken cancellation = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<AuditEntry>> OlderAsync(string kind, DateTimeOffset before, int limit, CancellationToken cancellation = default) => throw new NotSupportedException();
        public Task<int> PruneAsync(string kind, DateTimeOffset before, CancellationToken cancellation = default) => throw new NotSupportedException();
    }

    [Fact]
    public async Task Entries_close_together_are_stored_in_one_write()
    {
        var store = new CountingStore();
        using var audit = new AuditLog(store, TimeProvider.System, NullLoggerFactory.Instance);
        await audit.StartAsync(Token);
        for (var index = 0; index < 3; index++)
        {
            audit.RecordSystem("test.entry");
            await Task.Delay(100, Token);
        }
        await Task.Delay(AuditLog.Gather + TimeSpan.FromSeconds(1), Token);
        Assert.Equal([3], store.Writes);
        await audit.StopAsync(Token);
    }

    [Fact]
    public async Task A_flush_stores_at_once_and_stopping_stores_the_rest()
    {
        var store = new CountingStore();
        using var audit = new AuditLog(store, TimeProvider.System, NullLoggerFactory.Instance);
        await audit.StartAsync(Token);
        audit.RecordSystem("test.flushed");
        var clock = Stopwatch.StartNew();
        await audit.FlushAsync(Token);
        Assert.True(clock.Elapsed < AuditLog.Gather, $"the flush took {clock.Elapsed}");
        Assert.Equal([1], store.Writes);

        audit.RecordSystem("test.at-stop");
        await audit.StopAsync(Token);
        Assert.Equal([1, 1], store.Writes);
    }
}
