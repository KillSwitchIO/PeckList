namespace PeckList.Server.Tests;

public sealed class HealthCheckCommandTests
{
    [Fact]
    public async Task Fails_when_nothing_answers()
    {
        // Port 9 (discard) has nothing listening on a test machine.
        Assert.Equal(1, await HealthCheckCommand.RunAsync("9"));
    }
}
