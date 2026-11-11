using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PeckList.Client;

/// <summary>A refusal from the server, as its problem document says it (or as close as an older answer gets).</summary>
public sealed class ApiProblem(int status, string code, string detail) : Exception(detail)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

/// <summary>
/// The server, over HTTP: the task API and the admin API, as one account through its key. Follows
/// no redirects (a token never goes to another address) and never writes the token anywhere.
/// </summary>
public sealed class Remote : IDisposable
{
    private readonly HttpClient http;

    public Uri Server { get; }

    public static string Version { get; } =
        typeof(Remote).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "0.0.0";

    public Remote(Uri server, string? token, HttpMessageHandler? handler = null)
    {
        Server = server;
        http = handler is null
            ? new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false })
            : new HttpClient(handler, disposeHandler: false);
        // A base with a path (behind a proxy at /pecklist) keeps it: relative paths join after it.
        http.BaseAddress = new Uri(server.AbsoluteUri.TrimEnd('/') + "/");
        http.Timeout = TimeSpan.FromSeconds(60);
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("pecklist-cli", Version));
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (token is not null) http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    public void Dispose() => http.Dispose();

    /// <summary>The JSON answer (null for 204), or an <see cref="ApiProblem"/>.</summary>
    public async Task<JsonNode?> SendAsync(HttpMethod method, string path, JsonNode? body = null, CancellationToken cancellation = default)
    {
        using var response = await SendRawAsync(method, path, body, cancellation);
        await ThrowIfFailedAsync(response, cancellation);
        if (response.StatusCode == HttpStatusCode.NoContent) return null;
        var text = await response.Content.ReadAsStringAsync(cancellation);
        if (text.Length == 0) return null;
        try
        {
            return JsonNode.Parse(text);
        }
        catch (JsonException)
        {
            throw new ApiProblem((int)response.StatusCode, "not_json", $"{Server} did not answer with JSON: is it a PeckList server?");
        }
    }

    public Task<JsonNode?> GetAsync(string path, CancellationToken cancellation = default) => SendAsync(HttpMethod.Get, path, null, cancellation);

    /// <summary>A download (a backup) copied to <paramref name="target"/>.</summary>
    public async Task DownloadAsync(string path, Stream target, CancellationToken cancellation = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path.TrimStart('/'));
        using var response = await SendRequestAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation);
        await ThrowIfFailedAsync(response, cancellation);
        await using var stream = await response.Content.ReadAsStreamAsync(cancellation);
        await stream.CopyToAsync(target, cancellation);
    }

    private async Task<HttpResponseMessage> SendRawAsync(HttpMethod method, string path, JsonNode? body, CancellationToken cancellation)
    {
        using var request = new HttpRequestMessage(method, path.TrimStart('/'));
        if (body is not null) request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        return await SendRequestAsync(request, HttpCompletionOption.ResponseContentRead, cancellation);
    }

    private async Task<HttpResponseMessage> SendRequestAsync(HttpRequestMessage request, HttpCompletionOption completion, CancellationToken cancellation)
    {
        try
        {
            return await http.SendAsync(request, completion, cancellation);
        }
        catch (HttpRequestException error)
        {
            throw new ApiProblem(0, "unreachable", $"cannot reach {Server}: {error.Message}");
        }
        catch (TaskCanceledException) when (!cancellation.IsCancellationRequested)
        {
            throw new ApiProblem(0, "timeout", $"{Server} did not answer in time");
        }
    }

    private async Task ThrowIfFailedAsync(HttpResponseMessage response, CancellationToken cancellation)
    {
        var status = (int)response.StatusCode;
        if (status is >= 300 and < 400)
        {
            var to = response.Headers.Location?.ToString() ?? "another address";
            throw new ApiProblem(status, "redirect", $"{Server} redirects to {to}; sign in with that address instead (redirects are not followed)");
        }
        if (response.IsSuccessStatusCode) return;
        string? code = null;
        string? detail = null;
        try
        {
            if (JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellation)) is JsonObject problem)
            {
                // A problem document (the task API), or {error, message} (older routes, the admin API).
                code = (string?)problem["code"] ?? (string?)problem["error"];
                detail = (string?)problem["detail"] ?? (string?)problem["message"];
                if (problem["errors"] is JsonObject errors && errors.Count > 0)
                {
                    detail = string.Join("; ", errors.Select(pair => $"{pair.Key}: {(pair.Value is JsonArray each ? string.Join(", ", each.Select(one => one?.ToString())) : pair.Value?.ToString())}"));
                }
            }
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or FormatException)
        {
            // Not JSON, or not the shape we know: the status says it.
            code = null;
            detail = null;
        }
        code ??= status switch
        {
            401 => "unauthorized",
            403 => "forbidden",
            404 => "not_found",
            429 => "rate_limited",
            _ => "failed",
        };
        detail ??= status switch
        {
            401 => "not signed in, or the key no longer works",
            403 => "not allowed",
            404 => "not found",
            _ => $"the server answered {status} {response.ReasonPhrase}",
        };
        throw new ApiProblem(status, code, detail);
    }
}
