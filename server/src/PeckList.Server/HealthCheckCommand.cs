namespace PeckList.Server;

/// <summary>Asks the running server's <c>/healthz</c> on this machine; exit code 0 when healthy.</summary>
public static class HealthCheckCommand
{
    public static async Task<int> RunAsync(string? httpPorts)
    {
        // ASPNETCORE_HTTP_PORTS may list several ports ("8080;8081"); the first one answers.
        var port = httpPorts?.Split([';', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault() ?? "8080";
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        try
        {
            using var response = await client.GetAsync($"http://127.0.0.1:{port}/healthz");
            return response.IsSuccessStatusCode ? 0 : 1;
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            await Console.Error.WriteLineAsync($"unhealthy: {error.Message}");
            return 1;
        }
    }
}
