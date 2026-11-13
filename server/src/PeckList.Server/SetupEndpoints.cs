using PeckList.Core.Accounts;
using PeckList.Server.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server;

public sealed record SetupState(bool Done);

/// <summary>
/// <c>/api/admin/setup</c> (spec: First-run wizard): whether the server's first setup is finished.
/// The wizard saves its choices through the settings API; this only remembers that it is done (or
/// was waved away), so it stops offering itself.
/// </summary>
public static class SetupEndpoints
{
    private const string Kind = Core.Sync.ServerEpoch.Kind;
    private const string Name = "setup";

    public static RouteGroupBuilder MapSetup(this RouteGroupBuilder admin)
    {
        admin.MapGet("/setup", async (ISecretStore secrets, CancellationToken cancellation) =>
            new SetupState(await DoneAsync(secrets, cancellation)))
            .WithSummary("Whether the first-run setup is done").RequirePermission(Permission.ManageSettings);

        admin.MapPut("/setup", async (SetupState state, ISecretStore secrets, CancellationToken cancellation) =>
        {
            await secrets.PutAsync(Kind, Name, state.Done ? "done" : "", cancellation);
            return new SetupState(state.Done);
        }).WithSummary("Mark the first-run setup done (or not)").RequirePermission(Permission.ManageSettings).Audited("settings.setup-finished", targetRoute: null);

        return admin;
    }

    public static async Task<bool> DoneAsync(ISecretStore secrets, CancellationToken cancellation = default) =>
        (await secrets.ListAsync(Kind, cancellation)).Any(each => each.Name == Name && each.Value == "done");
}
