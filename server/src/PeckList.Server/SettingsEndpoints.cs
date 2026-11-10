using System.Security.Claims;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
using PeckList.Core.Mail;
using PeckList.Server.Audit;
using PeckList.Server.Auth;
using PeckList.Server.Logging;

namespace PeckList.Server;

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
    bool Live,
    bool SuperAdminOnly = false);

public sealed record SettingsView(
    IReadOnlyList<SettingView> Settings, bool PendingRestart, string? Problem, IReadOnlyList<MailPresetView>? MailProviders = null);

/// <summary>
/// A mail provider the admin can pick (<c>SMTP_PROVIDER</c>): the settings it fills in, which the
/// page shows greyed out with these values, and what it only suggests (Amazon SES's regional host).
/// </summary>
public sealed record MailPresetView(string Name, string DisplayName, IReadOnlyDictionary<string, string> Sets, IReadOnlyDictionary<string, string> Suggests)
{
    public static IReadOnlyList<MailPresetView> All { get; } =
    [
        .. MailProviders.All.Select(each => new MailPresetView(each.Name, each.DisplayName, each.Sets,
            each.HostVaries ? new Dictionary<string, string> { ["SMTP_HOST"] = each.Host } : new Dictionary<string, string>())),
    ];
}

public sealed record SettingsChange(Dictionary<string, string?>? Values);

/// <summary>Where the admin's test email goes.</summary>
public sealed record TestMailRequest(string? To);

/// <summary>
/// <c>/api/admin/settings</c> (spec: Server settings): every setting with where its value comes
/// from; saving page values (checked like the environment's, refused where the environment or
/// config file already decides); and a restart to apply them. Settings that decide who signs in
/// (<see cref="SettingsCatalog.SuperAdminOnly"/>) are shown to admins but saved by super admins only.
/// </summary>
public static class SettingsEndpoints
{
    /// <summary>What a secret shows as, set or not: never the value.</summary>
    public const string Hidden = "********";

    public static RouteGroupBuilder MapSettings(this RouteGroupBuilder admin)
    {
        admin.MapGet("/settings", async (LoadedSettings loaded, Core.Accounts.ISecretStore secrets, ClaimsPrincipal user, CancellationToken cancellation) =>
            View(loaded, await SettingsLoader.ReadPageAsync(secrets, loaded.Layers.Cipher, cancellation), MaySaveSignIn(user)))
            .RequirePermission(Permission.ManageSettings);

        admin.MapPut("/settings", async (
            SettingsChange change, LoadedSettings loaded, Core.Accounts.ISecretStore secrets, IIdentityStore identities, LogPipeline logging, LiveSettings live,
            ClaimsPrincipal user, HttpContext context,
            CancellationToken cancellation) =>
        {
            var saved = await SettingsLoader.ReadPageAsync(secrets, loaded.Layers.Cipher, cancellation);
            var page = new Dictionary<string, string>(saved, StringComparer.Ordinal);
            // A secret sent back as shown means "unchanged".
            var values = (change.Values ?? []).Where(pair => pair.Value != Hidden).ToDictionary(pair => pair.Key, pair => pair.Value);
            // Which settings, never their values.
            context.Audit().Detail = string.Join(", ", values.Keys.Order(StringComparer.Ordinal));
            if (!MaySaveSignIn(user) && values.Keys.FirstOrDefault(SettingsCatalog.SuperAdminOnly) is { } guarded)
            {
                return Results.Json(new AdminError("super_admins_only", $"only a super admin changes {guarded}"),
                    statusCode: StatusCodes.Status403Forbidden);
            }
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
            if (await RemovedProviderInUseAsync(loaded.Layers.WithPage(saved), next, identities, cancellation) is { } inUse) return Results.Conflict(inUse);
            await SettingsLoader.SavePageAsync(secrets, values,
                key => SettingsCatalog.Find(layers, key)?.Kind == SettingKind.Secret, loaded.Layers.Cipher, cancellation);
            // Live settings apply at once; the rest at the next restart.
            if (values.Keys.Any(key => SettingsCatalog.Find(layers, key)?.Live == true))
            {
                live.Apply(next);
                logging.Apply(next.Logging);
            }
            return Results.Ok(View(loaded, page, MaySaveSignIn(user)));
        }).RequirePermission(Permission.ManageSettings).RequireRateLimiting(AuthSetup.SettingsRateLimit).Audited("settings.saved", targetRoute: null);

        // Stops the server; a container with a restart policy (restart: unless-stopped) comes back
        // with the saved values.
        admin.MapPost("/restart", (IHostApplicationLifetime lifetime) =>
        {
            ServerApp.StopSoon(lifetime);
            return Results.Accepted();
        }).RequirePermission(Permission.ManageSettings).Audited("server.restart", targetRoute: null);

        // Send test email (PL-122): with the settings as they apply now (a save applies at once),
        // to the address given; the mail server's own answer comes back in words when it fails.
        admin.MapPost("/mail/test", async (TestMailRequest request, IMailSender mail, LiveSettings live, CancellationToken cancellation) =>
        {
            if (!mail.Configured) return Results.Conflict(new AdminError("mail_not_set_up", "Pick a provider or set SMTP_HOST, and SMTP_FROM, first."));
            if (string.IsNullOrWhiteSpace(request.To) || !request.To.Contains('@'))
            {
                return Results.BadRequest(new AdminError("invalid_address", "Give an email address to send the test to."));
            }
            var server = live.Current.PublicUrl?.Host ?? "your server";
            try
            {
                await mail.SendAsync(new OutgoingMail(request.To.Trim(), $"Test email from PeckList on {server}",
                    $"This is a test email from PeckList on {server}. Email works: password reset links and invites can go out." + Environment.NewLine),
                    cancellation);
                return Results.NoContent();
            }
            catch (MailException error)
            {
                return Results.Json(new AdminError("mail_failed", error.Message), statusCode: StatusCodes.Status502BadGateway);
            }
        }).RequirePermission(Permission.ManageSettings).Audited("mail.test", targetRoute: null);

        return admin;
    }

    private static bool MaySaveSignIn(ClaimsPrincipal user) => user.AccountRole().Can(Permission.ManageSecurity);

    /// <summary>
    /// A provider still holding linked accounts cannot be taken off this page, renaming included (spec:
    /// Linking): those people would lose a way in without anyone having chosen that. Only a provider
    /// this save removes counts, so links left by one the environment dropped never block other saves.
    /// </summary>
    private static async Task<AdminError?> RemovedProviderInUseAsync(
        ISecretSource before, ServerSettings next, IIdentityStore identities, CancellationToken cancellation)
    {
        var removed = SettingsCatalog.ProviderNames(before).Except(next.OidcProviders.Select(provider => provider.Name)).ToHashSet();
        if (removed.Count == 0) return null;
        var linked = (await identities.ListAsync(cancellation))
            .Where(identity => removed.Contains(identity.Provider))
            .GroupBy(identity => identity.Provider)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select(group => $"{group.Key} ({group.Count()} {(group.Count() == 1 ? "account" : "accounts")})")
            .ToList();
        if (linked.Count == 0) return null;
        return new AdminError("provider_in_use",
            $"Still linked: {string.Join(", ", linked)}. Use Unbind all under Admin > Sign-in, or pecklist oidc unbind-all, then remove it. " +
            "Accounts and their data stay. To move people to another provider first, see the single sign-on guide.");
    }

    private static SettingsView View(LoadedSettings loaded, IReadOnlyDictionary<string, string> saved, bool maySaveSignIn)
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
            var superAdminOnly = SettingsCatalog.SuperAdminOnly(definition.Key);
            list.Add(new SettingView(
                definition.Key,
                definition.Group,
                definition.Kind.ToString().ToLowerInvariant(),
                definition.Choices,
                definition.Default,
                value,
                source.ToString().ToLowerInvariant(),
                definition.EnvironmentOnly || source is SettingSource.Environment or SettingSource.File || (superAdminOnly && !maySaveSignIn),
                saved.ContainsKey(definition.Key),
                definition.Live,
                superAdminOnly));
        }
        // Settings that apply while running never wait for a restart.
        bool Live(string key) => SettingsCatalog.Find(layers, key)?.Live == true;
        var pending = saved.Keys.Union(loaded.PageAtStart.Keys).Where(key => !Live(key)).Any(key =>
            saved.TryGetValue(key, out var now) != loaded.PageAtStart.TryGetValue(key, out var before) || now != before);
        return new SettingsView(list, pending, loaded.PageProblem, MailPresetView.All);
    }
}
