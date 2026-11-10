using Microsoft.Extensions.Logging.Abstractions;

namespace PeckList.Server.Tests;

/// <summary>Work handed off after a request runs in order, and one failure stops nothing (audit B2).</summary>
public sealed class BackgroundQueueTests
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Jobs_run_in_order_and_a_failing_one_does_not_stop_the_next()
    {
        var queue = new BackgroundQueue(NullLogger<BackgroundQueue>.Instance);
        await queue.StartAsync(Token);
        var ran = new List<int>();
        queue.Enqueue("first", _ => { ran.Add(1); return Task.CompletedTask; });
        queue.Enqueue("broken", _ => throw new InvalidOperationException("the push service said no"));
        queue.Enqueue("third", async stopping => { await Task.Yield(); ran.Add(3); });

        await queue.IdleAsync(Token);
        Assert.Equal([1, 3], ran);
        await queue.StopAsync(Token);
    }
}
