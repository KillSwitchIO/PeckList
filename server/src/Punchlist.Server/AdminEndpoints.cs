using Microsoft.Extensions.Caching.Memory;
using Punchlist.Core.Accounts;
using Punchlist.Core.Configuration;
using Punchlist.Server.Auth;

namespace Punchlist.Server;

public sealed record AdminUser(string Id, string Username, string Role, bool Disabled, DateTimeOffset CreatedAt, IReadOnlyList<string> Groups);

public sealed record RoleRequest(string Role);

public sealed record GroupRequest(string? Name, bool? OfferedForSharing);

public sealed record AdminGroupMember(string AccountId, IReadOnlyList<string> Sources);

public sealed record AdminGroup(string Id, string Name, bool OfferedForSharing, DateTimeOffset CreatedAt, IReadOnlyList<AdminGroupMember> Members);

public sealed record AdminError(string Error, string? Message = null);

public sealed record AdminProvider(string Name, string DisplayName, int Linked, DateTimeOffset? MigrationWindowUntil);

public sealed record UnbindResult(int Unbound, IReadOnlyList<string> Stranded);

public sealed record WindowRequest(double? Hours);

public sealed record LoginLinkView(string Url, DateTimeOffset Expires);

/// <summary>
/// <c>/api/admin</c>: users and server groups (spec: Accounts &amp; Admin). Every endpoint names the
/// permission it needs; a test checks that none is left without one.
/// </summary>
public static class AdminEndpoints
{
    public static RouteGroupBuilder MapAdmin(this RouteGroupBuilder admin)
    {
        admin.MapGet("/users", async (IAccountStore accounts, ServerGroupService groups, CancellationToken cancellation) =>
        {
            var all = await accounts.ListAsync(cancellation);
            var views = await groups.ListAsync(cancellation);
            return all.Select(account => new AdminUser(
                account.Id,
                account.Username,
                account.Role.Name(),
                account.Disabled,
                account.CreatedAt,
                views.Where(view => view.Members.Any(member => member.AccountId == account.Id)).Select(view => view.Group.Id).ToList()));
        }).RequirePermission(Permission.ManageUsers);

        admin.MapPut("/users/{id}/role", async (string id, RoleRequest request, AccountService accounts, IMemoryCache cache, CancellationToken cancellation) =>
        {
            if (!Roles.TryParse(request.Role, out var role)) return Results.BadRequest(new AdminError("invalid_role"));
            try
            {
                var account = await accounts.SetRoleAsync(id, role, cancellation);
                // This process changed it: the next request already sees the new role.
                AuthSetup.ForgetStamp(cache, id);
                return Results.Ok(new { account.Id, Role = account.Role.Name() });
            }
            catch (KeyNotFoundException)
            {
                return Results.NotFound();
            }
            catch (LastSuperAdminException error)
            {
                return Results.Conflict(new AdminError("last_super_admin", error.Message));
            }
        }).RequirePermission(Permission.ManageAdmins);

        // Linked provider accounts and moving between providers (spec: Linking and provider migration).
        admin.MapGet("/users/{id}/identities", async (string id, ExternalSignIn signIn, ServerSettings settings, CancellationToken cancellation) =>
            (await signIn.IdentitiesOfAsync(id, cancellation)).Select(identity => AccountEndpoints.View(identity, settings)))
            .RequirePermission(Permission.ManageUsers);

        admin.MapDelete("/users/{id}/identities/{provider}/{subject}", async (
            string id, string provider, string subject, ExternalSignIn signIn, IAccountStore accounts, CancellationToken cancellation) =>
        {
            if (await signIn.UnlinkAsync(id, provider, subject, selfService: false, cancellation) != UnlinkResult.Unlinked) return Results.NotFound();
            var account = await accounts.FindByIdAsync(id, cancellation);
            var stranded = account is not null && !await signIn.CanSignInAsync(account, cancellation);
            return Results.Ok(new UnbindResult(1, stranded ? [account!.Username] : []));
        }).RequirePermission(Permission.ManageUsers);

        admin.MapGet("/providers", async (ServerSettings settings, ExternalSignIn signIn, IIdentityStore identities, CancellationToken cancellation) =>
        {
            var linked = await identities.ListAsync(cancellation);
            var list = new List<AdminProvider>();
            foreach (var provider in settings.OidcProviders)
            {
                list.Add(new AdminProvider(provider.Name, provider.DisplayName, linked.Count(each => each.Provider == provider.Name),
                    await signIn.MigrationWindowAsync(provider.Name, cancellation)));
            }
            return list;
        }).RequirePermission(Permission.ManageUsers);

        // Unbinding works for providers no longer configured too: that is how their links are cleared.
        admin.MapPost("/providers/{name}/unbind-all", async (string name, ExternalSignIn signIn, CancellationToken cancellation) =>
        {
            var (unbound, stranded) = await signIn.UnbindProviderAsync(name, cancellation);
            return Results.Ok(new UnbindResult(unbound, stranded));
        }).RequirePermission(Permission.ManageUsers);

        admin.MapPut("/providers/{name}/migration-window", async (
            string name, WindowRequest request, ServerSettings settings, ExternalSignIn signIn, CancellationToken cancellation) =>
        {
            if (settings.OidcProviders.All(provider => provider.Name != name)) return Results.NotFound();
            var hours = request.Hours ?? 24;
            if (hours is <= 0 or > 24 * 30) return Results.BadRequest(new AdminError("invalid_hours", "between a minute and 30 days"));
            return Results.Ok(new { Until = await signIn.OpenMigrationWindowAsync(name, TimeSpan.FromHours(hours), cancellation) });
        }).RequirePermission(Permission.ManageUsers);

        admin.MapDelete("/providers/{name}/migration-window", async (string name, ExternalSignIn signIn, CancellationToken cancellation) =>
        {
            await signIn.CloseMigrationWindowAsync(name, cancellation);
            return Results.NoContent();
        }).RequirePermission(Permission.ManageUsers);

        admin.MapPost("/users/{id}/login-link", async (string id, LoginLinks links, HttpContext context, CancellationToken cancellation) =>
        {
            try
            {
                var (token, expires) = await links.CreateAsync(id, cancellation: cancellation);
                return Results.Ok(new LoginLinkView($"{ServerApp.Origin(context)}/auth/link/{token}", expires));
            }
            catch (KeyNotFoundException)
            {
                return Results.NotFound();
            }
        }).RequirePermission(Permission.ManageUsers);

        admin.MapGet("/pending-signins", async (IIdentityStore identities, CancellationToken cancellation) =>
            await identities.ListPendingAsync(cancellation)).RequirePermission(Permission.ManageUsers);

        admin.MapPost("/pending-signins/{provider}/{subject}/approve", async (
            string provider, string subject, ServerSettings settings, ExternalSignIn signIn, CancellationToken cancellation) =>
        {
            if (settings.OidcProviders.FirstOrDefault(each => each.Name == provider) is not { } found) return Results.NotFound();
            return await signIn.ApproveAsync(found, subject, cancellation) is { } account
                ? Results.Ok(new { account.Id, account.Username, Role = account.Role.Name() })
                : Results.NotFound();
        }).RequirePermission(Permission.ManageUsers);

        admin.MapDelete("/pending-signins/{provider}/{subject}", async (string provider, string subject, IIdentityStore identities, CancellationToken cancellation) =>
            await identities.RemovePendingAsync(provider, subject, cancellation) ? Results.NoContent() : Results.NotFound())
            .RequirePermission(Permission.ManageUsers);

        admin.MapGet("/groups", async (ServerGroupService groups, CancellationToken cancellation) =>
            (await groups.ListAsync(cancellation)).Select(View)).RequirePermission(Permission.ManageGroups);

        admin.MapPost("/groups", async (GroupRequest request, ServerGroupService groups, CancellationToken cancellation) =>
            await GroupResult(async () =>
            {
                var group = await groups.CreateAsync(request.Name ?? "", request.OfferedForSharing ?? false, cancellation);
                return Results.Created($"/api/admin/groups/{group.Id}", View(new ServerGroupView(group, [])));
            })).RequirePermission(Permission.ManageGroups);

        admin.MapPatch("/groups/{id}", async (string id, GroupRequest request, ServerGroupService groups, CancellationToken cancellation) =>
            await GroupResult(async () =>
            {
                await groups.UpdateAsync(id, request.Name, request.OfferedForSharing, cancellation);
                return Results.Ok((await groups.ListAsync(cancellation)).Where(view => view.Group.Id == id).Select(View).Single());
            })).RequirePermission(Permission.ManageGroups);

        admin.MapDelete("/groups/{id}", async (string id, ServerGroupService groups, CancellationToken cancellation) =>
            await groups.DeleteAsync(id, cancellation) ? Results.NoContent() : Results.NotFound())
            .RequirePermission(Permission.ManageGroups);

        // Members added by hand; ones from an identity provider come and go with its sign-ins.
        admin.MapPut("/groups/{id}/members/{accountId}", (string id, string accountId, ServerGroupService groups, CancellationToken cancellation) =>
            GroupResult(async () =>
            {
                await groups.SetManualMemberAsync(id, accountId, member: true, cancellation);
                return Results.NoContent();
            })).RequirePermission(Permission.ManageGroups);

        admin.MapDelete("/groups/{id}/members/{accountId}", (string id, string accountId, ServerGroupService groups, CancellationToken cancellation) =>
            GroupResult(async () =>
            {
                await groups.SetManualMemberAsync(id, accountId, member: false, cancellation);
                return Results.NoContent();
            })).RequirePermission(Permission.ManageGroups);

        return admin;
    }

    private static AdminGroup View(ServerGroupView view) => new(
        view.Group.Id,
        view.Group.Name,
        view.Group.OfferedForSharing,
        view.Group.CreatedAt,
        view.Members.Select(member => new AdminGroupMember(member.AccountId, member.Sources)).ToList());

    private static async Task<IResult> GroupResult(Func<Task<IResult>> action)
    {
        try
        {
            return await action();
        }
        catch (KeyNotFoundException)
        {
            return Results.NotFound();
        }
        catch (DuplicateGroupNameException error)
        {
            return Results.Conflict(new AdminError("name_taken", error.Message));
        }
        catch (ArgumentException error)
        {
            return Results.BadRequest(new AdminError("invalid_name", error.Message));
        }
    }
}
