using Punchlist.Core.Accounts;
using Punchlist.Core.Configuration;
using Punchlist.Server.Audit;
using Punchlist.Server.Auth;
using Punchlist.Server.Logging;

namespace Punchlist.Server;

public sealed record SettingView(
    string Key,
    string Group,
    string Kind,
    IReadOnlyList<string>? Choices,
    string? Default,
    string? Value,
    string Source,
    bool Locked,
    bool Saved,
    bool Live);

public sealed record SettingsView(IReadOnlyList<SettingView> Settings, bool PendingRestart, string? Problem);

public sealed record SettingsChange(Dictionary<string, string?>? Values);

/// <summary>
/// <c>/api/admin/settings</c> (spec: Server settings): every setting with where its value comes
/// from; saving page values (checked like the environment's, refused where the environment or
/// config file already decides); and a restart to apply them.
/// </summary>
public static class SettingsEndpoints
{
    /// <summary>What a secret shows as, set or not: never the value.</summary>
    public const string Hidden = "********";

    public static RouteGroupBuilder MapSettings(this RouteGroupBuilder admin)
    {
        admin.MapGet("/settings", async (LoadedSettings loaded, Core.Accounts.ISecretStore secrets, CancellationToken cancellation) =>
            View(loaded, await SettingsLoader.ReadPageAsync(secrets, cancellation)))
            .RequirePermission(Permission.ManageSettings);

        admin.MapPut("/settings", async (
            SettingsChange change, LoadedSettings loaded, Core.Accounts.ISecretStore secrets, LogPipeline logging, LiveSettings live,
            HttpContext context,
            CancellationToken cancellation) =>
        {
            var saved = await SettingsLoader.ReadPageAsync(secrets, cancellation);
            var page = new Dictionary<string, string>(saved, StringComparer.Ordinal);
            // A secret sent back as shown means "unchanged".
            var values = (change.Values ?? []).Where(pair => pair.Value != Hidden).ToDictionary(pair => pair.Key, pair => pair.Value);
            // Which settings, never their values.
            context.Audit().Detail = string.Join(", ", values.Keys.Order(StringComparer.Ordinal));
            foreach (var (key, value) in values)
            {
                if (string.IsNullOrWhiteSpace(value)) page.Remove(key);
                else page[key] = value.Trim();
            }
            var layers = loaded.Layers.WithPage(page);
            foreach (var key in values.Keys)
            {
                var definition = SettingsCatalog.Find(layers, key) ?? SettingsCatalog.Find(loaded.Layers.WithPage(saved), key);
                if (definition is null) return Results.BadRequest(new AdminError("unknown_setting", key));
                if (definition.EnvironmentOnly || layers.Explain(key).Source is SettingSource.Environment or SettingSource.File)
                {
                    return Results.Conflict(new AdminError("locked", $"{key} is set outside this page"));
                }
            }
            ServerSettings next;
            try
            {
                next = ServerSettings.Read(layers, loaded.InContainer);
            }
            catch (SettingsException error)
            {
                return Results.BadRequest(new AdminError("invalid", error.Message));
            }
            await SettingsLoader.SavePageAsync(secrets, values,
                key => SettingsCatalog.Find(layers, key)?.Kind == SettingKind.Secret, cancellation);
            // Live settings apply at once; the rest at the next restart.
            if (values.Keys.Any(key => SettingsCatalog.Find(layers, key)?.Live == true))
            {
                live.Apply(next);
                logging.Apply(next.Logging);
            }
            return Results.Ok(View(loaded, page));
        }).RequirePermission(Permission.ManageSettings).Audited("settings.saved", targetRoute: null);

        // Stops the server; a container with a restart policy (restart: unless-stopped) comes back
        // with the saved values.
        admin.MapPost("/restart", (IHostApplicationLifetime lifetime) =>
        {
            _ = Task.Delay(500).ContinueWith(_ => lifetime.StopApplication(), TaskScheduler.Default);
            return Results.Accepted();
        }).RequirePermission(Permission.ManageSettings).Audited("server.restart", targetRoute: null);

        return admin;
    }

    private static SettingsView View(LoadedSettings loaded, IReadOnlyDictionary<string, string> saved)
    {
        var layers = loaded.Layers.WithPage(saved);
        var list = new List<SettingView>();
        foreach (var definition in SettingsCatalog.For(layers))
        {
            string? value;
            SettingSource source;
            try
            {
                (value, source) = layers.Explain(definition.Key);
            }
            catch (SettingsException)
            {
                (value, source) = (Hidden, SettingSource.Environment);
            }
            if (definition.Kind == SettingKind.Secret && value is not null) value = Hidden;
            list.Add(new SettingView(
                definition.Key,
                definition.Group,
                definition.Kind.ToString().ToLowerInvariant(),
                definition.Choices,
                definition.Default,
                value,
                source.ToString().ToLowerInvariant(),
                definition.EnvironmentOnly || source is SettingSource.Environment or SettingSource.File,
                saved.ContainsKey(definition.Key),
                definition.Live));
        }
        // Settings that apply while running never wait for a restart.
        bool Live(string key) => SettingsCatalog.Find(layers, key)?.Live == true;
        var pending = saved.Keys.Union(loaded.PageAtStart.Keys).Where(key => !Live(key)).Any(key =>
            saved.TryGetValue(key, out var now) != loaded.PageAtStart.TryGetValue(key, out var before) || now != before);
        return new SettingsView(list, pending, loaded.PageProblem);
    }
}
