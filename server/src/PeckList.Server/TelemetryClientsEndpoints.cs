using System.Security.Claims;
using System.Text.Json;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
using PeckList.Core.Telemetry;
using PeckList.Server.Auth;

namespace PeckList.Server;

/// <summary>What a person chose for themself (PL-116): share usage counts, and what to do with crash reports.</summary>
public sealed record TelemetryChoice(bool ShareUsage = true, string CrashReports = "ask")
{
    public static readonly IReadOnlySet<string> CrashChoices = new HashSet<string>(StringComparer.Ordinal) { "ask", "always", "never" };
}

/// <summary>
/// The app's view of telemetry: whether the server reports at all (so the app collects nothing when
/// it does not), and the person's own choices.
/// </summary>
public sealed record TelemetryStatus(bool Enabled, bool ShareUsage, string CrashReports, bool CrashReportsEnabled = false);

public sealed record TelemetryChoiceRequest(bool? ShareUsage, string? CrashReports);

/// <summary>
/// The people's choices and the day's client counts (PL-116), kept with the server's other small
/// values: one choice per account, and the tally until the next daily report takes it.
/// </summary>
public sealed class ClientTelemetry(ISecretStore secrets)
{
    public const string ChoiceKind = "telemetry-person";
    private const string TallyName = "clients";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim gate = new(1, 1);

    public async Task<TelemetryChoice> ChoiceAsync(string accountId, CancellationToken cancellation)
    {
        var stored = (await secrets.ListAsync(ChoiceKind, cancellation)).FirstOrDefault(each => each.Name == accountId).Value;
        if (string.IsNullOrEmpty(stored)) return new TelemetryChoice();
        try
        {
            return JsonSerializer.Deserialize<TelemetryChoice>(stored, Json) ?? new TelemetryChoice();
        }
        catch (JsonException)
        {
            return new TelemetryChoice();
        }
    }

    public Task SetChoiceAsync(string accountId, TelemetryChoice choice, CancellationToken cancellation) =>
        secrets.PutAsync(ChoiceKind, accountId, JsonSerializer.Serialize(choice, Json), cancellation);

    /// <summary>Add a device's report to the day's tally (the caller checked the person shares).</summary>
    public async Task AddAsync(string accountId, ClientReport report, CancellationToken cancellation)
    {
        await gate.WaitAsync(cancellation);
        try
        {
            var tally = await TallyLockedAsync(cancellation);
            tally.Add(accountId, report);
            await secrets.PutAsync(TelemetryReport.Kind, TallyName, JsonSerializer.Serialize(tally, Json), cancellation);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>The day's tally so far, for the report; null when no device reported.</summary>
    public async Task<TelemetryClients?> SummaryAsync(CancellationToken cancellation)
    {
        var tally = await TallyLockedAsync(cancellation);
        return tally.Empty ? null : tally.Summary();
    }

    /// <summary>Start a new day once the report went.</summary>
    public async Task ResetAsync(CancellationToken cancellation)
    {
        await gate.WaitAsync(cancellation);
        try
        {
            await secrets.PutAsync(TelemetryReport.Kind, TallyName, "", cancellation);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<ClientTally> TallyLockedAsync(CancellationToken cancellation)
    {
        var stored = (await secrets.ListAsync(TelemetryReport.Kind, cancellation)).FirstOrDefault(each => each.Name == TallyName).Value;
        if (string.IsNullOrEmpty(stored)) return new ClientTally();
        try
        {
            return JsonSerializer.Deserialize<ClientTally>(stored, Json) ?? new ClientTally();
        }
        catch (JsonException)
        {
            return new ClientTally();
        }
    }
}

public static class TelemetryClientsEndpoints
{
    /// <summary>
    /// <c>/api/telemetry</c>: the app asks whether to count and what the person chose, changes the
    /// choice, and sends its counts. With the server's reports off, or the person's sharing off,
    /// counts are dropped where they arrive.
    /// </summary>
    public static RouteGroupBuilder MapClientTelemetry(this RouteGroupBuilder api)
    {
        api.MapGet("/telemetry", async (ClaimsPrincipal user, ClientTelemetry clients, LiveSettings live, CancellationToken cancellation) =>
        {
            var choice = await clients.ChoiceAsync(user.UserId(), cancellation);
            return new TelemetryStatus(live.Current.Telemetry, choice.ShareUsage, choice.CrashReports, live.Current.CrashReports);
        });

        api.MapPut("/telemetry/choice", async (TelemetryChoiceRequest request, ClaimsPrincipal user, ClientTelemetry clients, LiveSettings live,
            CancellationToken cancellation) =>
        {
            if (user.Impersonator() is not null) return Results.Json(new AuthError("not_while_impersonating"), statusCode: StatusCodes.Status403Forbidden);
            if (request.CrashReports is { } crash && !TelemetryChoice.CrashChoices.Contains(crash)) return Results.BadRequest(new AuthError("invalid"));
            var choice = await clients.ChoiceAsync(user.UserId(), cancellation);
            choice = choice with
            {
                ShareUsage = request.ShareUsage ?? choice.ShareUsage,
                CrashReports = request.CrashReports ?? choice.CrashReports,
            };
            // "Never send" crash reports turns usage sharing off too (Ben, 2026-10-30).
            if (request.CrashReports == "never") choice = choice with { ShareUsage = false };
            await clients.SetChoiceAsync(user.UserId(), choice, cancellation);
            return Results.Ok(new TelemetryStatus(live.Current.Telemetry, choice.ShareUsage, choice.CrashReports, live.Current.CrashReports));
        });

        api.MapPost("/telemetry", async (ClientReport report, ClaimsPrincipal user, ClientTelemetry clients, LiveSettings live,
            CancellationToken cancellation) =>
        {
            // Viewing as someone never counts as them.
            if (!live.Current.Telemetry || user.Impersonator() is not null || user.ByKey()) return Results.NoContent();
            if (!(await clients.ChoiceAsync(user.UserId(), cancellation)).ShareUsage) return Results.NoContent();
            if (ClientUsage.Clean(report) is not { } clean) return Results.BadRequest(new AuthError("invalid"));
            await clients.AddAsync(user.UserId(), clean, cancellation);
            return Results.NoContent();
        });
        return api;
    }
}
