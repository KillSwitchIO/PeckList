using System.Security.Claims;
using Microsoft.Extensions.Caching.Memory;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
using PeckList.Core.Sharing;
using PeckList.Server.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server;

public sealed record AdminUser(
    string Id,
    string Username,
    string Role,
    bool Disabled,
    DateTimeOffset CreatedAt,
    IReadOnlyList<string> Groups,
    bool HasPassword,
    bool MustChangePassword,
    IReadOnlyList<string> Providers,
    DateTimeOffset? DeletedAt = null,
    DateTimeOffset? RemovedAt = null,
    IReadOnlyList<string>? PeopleGroups = null,
    string? Email = null,
    bool EmailConfirmed = false,
    int Passkeys = 0);

public sealed record NewUserRequest(string? Username, string? Role);

public sealed record LinkRequest(string? Provider, string? Subject);

public sealed record NewUser(string Id, string Username, string Role, string Password);

public sealed record DisabledRequest(bool Disabled);

public sealed record PasswordResetRequest(string? Password);

public sealed record PasswordReset(string Password);

public sealed record RoleRequest(string Role);

public sealed record GroupRequest(string? Name, bool? OfferedForSharing);

public sealed record AdminGroupMember(string AccountId, IReadOnlyList<string> Sources);

public sealed record AdminGroup(string Id, string Name, bool OfferedForSharing, DateTimeOffset CreatedAt, IReadOnlyList<AdminGroupMember> Members);

public sealed record AdminError(string Error, string? Message = null);

public sealed record AdminProvider(string Name, string DisplayName, int Linked, DateTimeOffset? MigrationWindowUntil);

/// <summary>The OIDC page (spec: Accounts &amp; Admin, Linking): providers, who is paired with what, mappings.</summary>
public sealed record OidcOverview(IReadOnlyList<OidcProviderView> Providers, IReadOnlyList<OidcAccount> Accounts, IReadOnlyList<OidcMappingView> Mappings);

public sealed record OidcProviderView(string Name, string DisplayName, string LinkByUsername, bool AutoCreate, bool LinkByEmail, DateTimeOffset? MigrationWindowUntil);

public sealed record OidcAccount(string Id, string Username, string Role, bool Disabled, IReadOnlyList<IdentityView> Identities);

/// <summary><paramref name="Source"/>: <c>settings</c> (USER_MAP, read-only here) or <c>admin</c>.</summary>
public sealed record OidcMappingView(
    string Provider, string ProviderUsername, string? AccountId, string AccountUsername, string Source, DateTimeOffset? CreatedAt);

public sealed record MappingRequest(string? Provider, string? ProviderUsername, string? AccountId);

public sealed record MoveRequest(string? AccountId);

public sealed record UnbindResult(int Unbound, IReadOnlyList<string> Stranded);

public sealed record WindowRequest(double? Hours);

public sealed record LoginLinkView(string Url, DateTimeOffset Expires);

public sealed record AdminFriend(string UserId, string Username, string State);

public sealed record FriendshipRequest(string? UserA, string? UserB);

public sealed record AdminShare(string Kind, string Id, string Name, int People);

public sealed record HandOverRequest(string? To, IReadOnlyList<string>? Ids);

/// <summary>A new invite: lasts <paramref name="Days"/> (7), for <paramref name="Uses"/> people (1; null for any number).</summary>
/// <paramref name="SendTo"/>: an email to send the link to as well (PL-122).
public sealed record InviteRequest(double? Days, int? Uses, string? Note, bool AnyNumber = false, string? SendTo = null);

public sealed record AdminInvite(
    string Id, string? Note, string CreatedBy, DateTimeOffset CreatedAt, DateTimeOffset Expires, int? MaxUses, int Uses, IReadOnlyList<string> UsedBy);

/// <summary>A just-made invite: its link is shown this once.</summary>
/// <summary>A just-made invite: its link is shown this once. <paramref name="Sent"/>: emailed to the address asked for; <paramref name="MailProblem"/>: why not.</summary>
public sealed record NewInvite(string Url, AdminInvite Invite, bool? Sent = null, string? MailProblem = null);

public sealed record InviteList(string Registration, IReadOnlyList<AdminInvite> Invites);

/// <summary>
/// <c>/api/admin</c>: users and server groups (spec: Accounts &amp; Admin). Every endpoint names the
/// permission it needs; a test checks that none is left without one.
/// </summary>
public static class AdminEndpoints
{
    public static RouteGroupBuilder MapAdmin(this RouteGroupBuilder admin)
    {
        admin.MapGet("/users", async (
            IAccountStore accounts, ServerGroupService groups, IIdentityStore identities, AccountRemoval removal, SharingState sharing,
            IPasskeyStore passkeys, CancellationToken cancellation) =>
        {
            var keys = (await passkeys.AllAsync(cancellation)).GroupBy(each => each.AccountId).ToDictionary(each => each.Key, each => each.Count());
            var index = sharing.Index;
            var all = await accounts.ListAsync(cancellation);
            var views = await groups.ListAsync(cancellation);
            var links = await identities.ListAsync(cancellation);
            return all.Select(account => new AdminUser(
                account.Id,
                account.Username,
                account.Role.Name(),
                account.Disabled,
                account.CreatedAt,
                views.Where(view => view.Members.Any(member => member.AccountId == account.Id)).Select(view => view.Group.Id).ToList(),
                account.PasswordHash is not null,
                account.MustChangePassword,
                links.Where(link => link.AccountId == account.Id).Select(link => link.Provider).Distinct().ToList(),
                account.DeletedAt,
                account.DeletedAt is null ? null : removal.RemovedAt(account),
                index.GroupNamesOf(account.Id),
                account.Email,
                account.EmailVerifiedAt is not null,
                keys.GetValueOrDefault(account.Id)));
        }).RequirePermission(Permission.ManageUsers);

        // Delete: turned off at once, removed for good after the grace period, restorable until then.
        admin.MapDelete("/users/{id}", async (
            string id, ClaimsPrincipal user, IAccountStore store, AccountService accounts, IMemoryCache cache, AccountRemoval removal,
            CancellationToken cancellation) =>
            await OnAccountAsync(id, user, store, account => AccountResult(async () =>
            {
                if (account.Id == user.UserId()) return Results.Conflict(new AdminError("self", "you cannot delete your own account"));
                var deleted = await accounts.DeleteAsync(id, cancellation);
                AuthSetup.ForgetStamp(cache, id);
                return Results.Ok(new { RemovedAt = removal.RemovedAt(deleted) });
            }), cancellation)).RequirePermission(Permission.ManageUsers).ProjectsServerGroups().Audited("admin.user-deleted");

        admin.MapPost("/users/{id}/restore", async (
            string id, ClaimsPrincipal user, IAccountStore store, AccountService accounts, IMemoryCache cache, CancellationToken cancellation) =>
            await OnAccountAsync(id, user, store, async account =>
            {
                if (account.DeletedAt is null) return Results.Conflict(new AdminError("not_deleted"));
                await accounts.RestoreAsync(id, cancellation);
                AuthSetup.ForgetStamp(cache, id);
                return Results.NoContent();
            }, cancellation)).RequirePermission(Permission.ManageUsers).ProjectsServerGroups().Audited("admin.user-restored");

        // Delete now: a deleted account goes for good without waiting out its grace period.
        admin.MapPost("/users/{id}/remove-now", async (
            string id, ClaimsPrincipal user, IAccountStore store, AccountRemoval removal, CancellationToken cancellation) =>
            await OnAccountAsync(id, user, store, async account =>
            {
                if (account.DeletedAt is null) return Results.Conflict(new AdminError("not_deleted"));
                await removal.RemoveNowAsync(id, cancellation);
                return Results.NoContent();
            }, cancellation)).RequirePermission(Permission.ManageUsers).Audited("admin.user-removed-now");

        admin.MapPost("/users", (NewUserRequest request, ClaimsPrincipal user, AccountService accounts, HttpContext context, CancellationToken cancellation) =>
            AccountResult(async () =>
            {
                var role = Role.User;
                if (request.Role is not null && !Roles.TryParse(request.Role, out role)) return Results.BadRequest(new AdminError("invalid_role"));
                if (role != Role.User && !user.AccountRole().Can(Permission.ManageAdmins)) return Results.Forbid();
                var username = (request.Username ?? "").Trim().ToLowerInvariant();
                if (!AccountService.IsValidUsername(username))
                {
                    return Results.BadRequest(new AdminError("invalid_username", "lowercase letters, digits, dots, dashes and underscores"));
                }
                var password = Core.Ids.NewPassword();
                var account = await accounts.CreateUserAsync(username, password, role, mustChangePassword: true, cancellation);
                context.Audit().On(account.Id, account.Username).Detail = $"role {role.Name()}";
                return Results.Created($"/api/admin/users/{account.Id}", new NewUser(account.Id, account.Username, role.Name(), password));
            })).RequirePermission(Permission.ManageUsers).Audited("admin.user-created", targetRoute: null);

        admin.MapPut("/users/{id}/disabled", async (
            string id, DisabledRequest request, ClaimsPrincipal user, IAccountStore store, AccountService accounts, IMemoryCache cache, HttpContext context,
            CancellationToken cancellation) =>
            await OnAccountAsync(id, user, store, account => AccountResult(async () =>
            {
                if (!request.Disabled) context.Audit().Type = "admin.user-enabled";
                if (account.DeletedAt is not null) return Results.Conflict(new AdminError("deleted", "restore the account instead"));
                if (account.Id == user.UserId() && request.Disabled) return Results.Conflict(new AdminError("self", "you cannot turn off your own account"));
                await accounts.SetDisabledAsync(id, request.Disabled, cancellation);
                AuthSetup.ForgetStamp(cache, id);
                return Results.NoContent();
            }), cancellation)).RequirePermission(Permission.ManageUsers).Audited("admin.user-disabled");

        admin.MapPost("/users/{id}/password", async (
            string id, PasswordResetRequest request, ClaimsPrincipal user, IAccountStore store, AccountService accounts, IMemoryCache cache, CancellationToken cancellation) =>
            await OnAccountAsync(id, user, store, async _ =>
            {
                try
                {
                    var password = await accounts.SetPasswordAsync(id, request.Password, cancellation);
                    AuthSetup.ForgetStamp(cache, id);
                    return Results.Ok(new PasswordReset(password));
                }
                catch (ArgumentException error)
                {
                    var code = request.Password?.Length > AccountService.MaxNewPasswordLength ? "too_long" : "too_short";
                    return Results.BadRequest(new AdminError(code, error.Message));
                }
            }, cancellation)).RequirePermission(Permission.ManageUsers).Audited("admin.password-reset");

        admin.MapPut("/users/{id}/role", (string id, RoleRequest request, AccountService accounts, IMemoryCache cache, HttpContext context, CancellationToken cancellation) =>
            AccountResult(async () =>
            {
                context.Audit().Detail = $"role {request.Role}";
                if (!Roles.TryParse(request.Role, out var role)) return Results.BadRequest(new AdminError("invalid_role"));
                var account = await accounts.SetRoleAsync(id, role, cancellation);
                // This process changed it: the next request already sees the new role.
                AuthSetup.ForgetStamp(cache, id);
                return Results.Ok(new { account.Id, Role = account.Role.Name() });
            })).RequirePermission(Permission.ManageAdmins).Audited("admin.role-changed");

        // Linked provider accounts and moving between providers (spec: Linking and provider migration).
        admin.MapGet("/users/{id}/identities", async (
            string id, ClaimsPrincipal user, IAccountStore accounts, ExternalSignIn signIn, ServerSettings settings, CancellationToken cancellation) =>
            await OnAccountAsync(id, user, accounts, async _ =>
                Results.Ok((await signIn.IdentitiesOfAsync(id, cancellation)).Select(identity => AccountEndpoints.View(identity, settings)).ToList()),
                cancellation))
            .RequirePermission(Permission.ManageUsers);

        admin.MapDelete("/users/{id}/identities/{provider}/{subject}", async (
            string id, string provider, string subject, ClaimsPrincipal user, ExternalSignIn signIn, IAccountStore accounts, HttpContext context,
            CancellationToken cancellation) =>
            await OnAccountAsync(id, user, accounts, async account =>
            {
                context.Audit().Detail = provider;
                if (await signIn.UnlinkAsync(id, provider, subject, selfService: false, cancellation) != UnlinkResult.Unlinked) return Results.NotFound();
                var stranded = !await signIn.CanSignInAsync((await accounts.FindByIdAsync(id, cancellation))!, cancellation);
                return Results.Ok(new UnbindResult(1, stranded ? [account.Username] : []));
            }, cancellation)).RequirePermission(Permission.ManageUsers).Audited("admin.identity-unlinked");

        // Attach a provider account by hand: its subject, or a waiting sign-in's.
        admin.MapPost("/users/{id}/identities", async (
            string id, LinkRequest request, ClaimsPrincipal user, ExternalSignIn signIn, IAccountStore accounts, ServerSettings settings,
            HttpContext context, CancellationToken cancellation) =>
            await OnAccountAsync(id, user, accounts, async _ =>
            {
                var subject = request.Subject?.Trim() ?? "";
                context.Audit().Detail = request.Provider;
                if (settings.Provider(request.Provider) is null || subject.Length == 0)
                {
                    return Results.BadRequest(new AdminError("invalid", "a configured provider and the account's subject"));
                }
                return await signIn.LinkByAdminAsync(request.Provider!, subject, id, cancellation) == LinkResult.Linked
                    ? Results.NoContent()
                    : Results.Conflict(new AdminError("taken", "that provider account is linked to someone else"));
            }, cancellation)).RequirePermission(Permission.ManageUsers).Audited("admin.identity-linked");

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
        admin.MapPost("/providers/{name}/unbind-all", async (string name, ExternalSignIn signIn, HttpContext context, CancellationToken cancellation) =>
        {
            var (unbound, stranded) = await signIn.UnbindProviderAsync(name, cancellation);
            context.Audit().Detail = $"{unbound} accounts detached";
            return Results.Ok(new UnbindResult(unbound, stranded));
        }).RequirePermission(Permission.ManageUsers).Audited("admin.provider-unbound", "name", AuditTarget.Name);

        admin.MapPut("/providers/{name}/migration-window", async (
            string name, WindowRequest request, ServerSettings settings, ExternalSignIn signIn, HttpContext context, CancellationToken cancellation) =>
        {
            if (settings.Provider(name) is null) return Results.NotFound();
            var hours = request.Hours ?? 24;
            context.Audit().Detail = $"{hours} hours";
            if (hours is <= 0 or > 24 * 30) return Results.BadRequest(new AdminError("invalid_hours", "between a minute and 30 days"));
            return Results.Ok(new { Until = await signIn.OpenMigrationWindowAsync(name, TimeSpan.FromHours(hours), cancellation) });
        }).RequirePermission(Permission.ManageUsers).Audited("admin.migration-window-opened", "name", AuditTarget.Name);

        admin.MapDelete("/providers/{name}/migration-window", async (string name, ExternalSignIn signIn, CancellationToken cancellation) =>
        {
            await signIn.CloseMigrationWindowAsync(name, cancellation);
            return Results.NoContent();
        }).RequirePermission(Permission.ManageUsers).Audited("admin.migration-window-closed", "name", AuditTarget.Name);

        // The OIDC page: who is paired with which provider account, and the mappings (spec: Linking).
        admin.MapGet("/oidc", async (
            ServerSettings settings, ExternalSignIn signIn, IIdentityStore identities, IAccountStore accounts, CancellationToken cancellation) =>
        {
            var all = (await accounts.ListAsync(cancellation)).Where(account => account.DeletedAt is null).ToList();
            var byId = all.ToDictionary(account => account.Id);
            var byName = all.ToDictionary(account => account.Username, StringComparer.OrdinalIgnoreCase);
            var links = (await identities.ListAsync(cancellation)).ToLookup(identity => identity.AccountId);
            var providers = new List<OidcProviderView>();
            foreach (var provider in settings.OidcProviders)
            {
                providers.Add(new OidcProviderView(provider.Name, provider.DisplayName,
                    provider.LinkByUsername switch { UsernameLinking.All => "all", UsernameLinking.Users => "true", _ => "false" },
                    provider.AutoCreate, provider.LinkByEmail, await signIn.MigrationWindowAsync(provider.Name, cancellation)));
            }
            var mappings = new List<OidcMappingView>();
            foreach (var provider in settings.OidcProviders)
            {
                foreach (var (providerUser, target) in provider.UserMap.OrderBy(pair => pair.Key, StringComparer.Ordinal))
                {
                    mappings.Add(new OidcMappingView(provider.Name, providerUser, byName.GetValueOrDefault(target)?.Id, target, "settings", null));
                }
            }
            foreach (var mapping in await identities.ListMappingsAsync(cancellation))
            {
                if (settings.Provider(mapping.Provider)?.UserMap.ContainsKey(mapping.ProviderUsername) == true) continue;
                mappings.Add(new OidcMappingView(mapping.Provider, mapping.ProviderUsername, mapping.AccountId,
                    byId.GetValueOrDefault(mapping.AccountId)?.Username ?? mapping.AccountId, "admin", mapping.CreatedAt));
            }
            return new OidcOverview(
                providers,
                all.OrderBy(account => account.Username, StringComparer.Ordinal)
                    .Select(account => new OidcAccount(account.Id, account.Username, account.Role.Name(), account.Disabled,
                        links[account.Id].Select(identity => AccountEndpoints.View(identity, settings)).ToList()))
                    .ToList(),
                mappings);
        }).RequirePermission(Permission.ManageUsers);

        // Map a provider username to an account: their next sign-in lands there, even when linked elsewhere.
        admin.MapPut("/oidc/mappings", async (
            MappingRequest request, ClaimsPrincipal user, ServerSettings settings, IIdentityStore identities, IAccountStore accounts,
            TimeProvider time, HttpContext context, CancellationToken cancellation) =>
        {
            var name = request.ProviderUsername?.Trim().ToLowerInvariant() ?? "";
            context.Audit().Detail = $"{request.Provider}: {name}";
            if (settings.Provider(request.Provider) is not { } provider || name.Length is 0 or > 255 || string.IsNullOrEmpty(request.AccountId))
            {
                return Results.BadRequest(new AdminError("invalid", "a configured provider, a provider username and an account"));
            }
            if (provider.UserMap.ContainsKey(name))
            {
                return Results.Conflict(new AdminError("set_by_settings", $"OIDC_..._USER_MAP already maps {name}"));
            }
            return await OnAccountAsync(request.AccountId, user, accounts, async account =>
            {
                context.Audit().Detail = $"{provider.Name}: {name} to {account.Username}";
                await identities.PutMappingAsync(new IdentityMapping
                {
                    Provider = provider.Name,
                    ProviderUsername = name,
                    AccountId = account.Id,
                    CreatedAt = time.GetUtcNow(),
                }, cancellation);
                return Results.NoContent();
            }, cancellation);
        }).RequirePermission(Permission.ManageUsers).Audited("admin.oidc-mapping-saved", targetRoute: null);

        admin.MapDelete("/oidc/mappings/{provider}/{providerUsername}", async (
            string provider, string providerUsername, ServerSettings settings, IIdentityStore identities, HttpContext context,
            CancellationToken cancellation) =>
        {
            context.Audit().Detail = $"{provider}: {providerUsername}";
            if (settings.Provider(provider)?.UserMap.ContainsKey(providerUsername.ToLowerInvariant()) == true)
            {
                return Results.Conflict(new AdminError("set_by_settings", "change OIDC_..._USER_MAP to remove this one"));
            }
            return await identities.RemoveMappingAsync(provider, providerUsername, cancellation) ? Results.NoContent() : Results.NotFound();
        }).RequirePermission(Permission.ManageUsers).Audited("admin.oidc-mapping-removed", targetRoute: null);

        // Remap: the provider account signs into another account from now on. Nothing the old account owns moves.
        admin.MapPut("/oidc/identities/{provider}/{subject}/account", async (
            string provider, string subject, MoveRequest request, ClaimsPrincipal user, ExternalSignIn signIn, IIdentityStore identities,
            IAccountStore accounts, HttpContext context, CancellationToken cancellation) =>
        {
            if (await identities.FindAsync(provider, subject, cancellation) is not { } link) return Results.NotFound();
            return await OnAccountAsync(link.AccountId, user, accounts, from =>
                OnAccountAsync(request.AccountId ?? "", user, accounts, async to =>
                {
                    context.Audit().Detail = $"{provider} {link.Username ?? subject}: {from.Username} to {to.Username}";
                    await signIn.MoveLinkAsync(provider, subject, to.Id, cancellation);
                    var stranded = !await signIn.CanSignInAsync(from, cancellation);
                    return Results.Ok(new UnbindResult(1, stranded ? [from.Username] : []));
                }, cancellation), cancellation);
        }).RequirePermission(Permission.ManageUsers).Audited("admin.identity-moved", targetRoute: null);

        admin.MapPost("/users/{id}/login-link", async (
            string id, ClaimsPrincipal user, IAccountStore accounts, LoginLinks links, HttpContext context, CancellationToken cancellation) =>
            await OnAccountAsync(id, user, accounts, async _ =>
            {
                var (token, expires) = await links.CreateAsync(id, cancellation: cancellation);
                return Results.Ok(new LoginLinkView($"{ServerApp.Origin(context)}/auth/link/{token}", expires));
            }, cancellation)).RequirePermission(Permission.ManageUsers).Audited("admin.login-link-created");

        // Friendships admins set up or end for people (spec: Account management).
        admin.MapGet("/users/{id}/friends", async (
            string id, ClaimsPrincipal user, SharingState sharing, IAccountStore accounts, CancellationToken cancellation) =>
            await OnAccountAsync(id, user, accounts, async _ =>
            {
                var names = await NamesAsync(accounts, cancellation);
                return Results.Ok(sharing.Index.FriendshipsOf(id)
                    .Where(each => names.ContainsKey(each.Other))
                    .Select(each => new AdminFriend(each.Other, names[each.Other], each.State))
                    .OrderBy(friend => friend.Username)
                    .ToList());
            }, cancellation)).RequirePermission(Permission.ManageUsers);

        // Pending task invites between the two settle as they would after a friend link.
        admin.MapPost("/friendships", async (
            FriendshipRequest request, ClaimsPrincipal user, Friends friends, Invites invites, IAccountStore accounts, HttpContext context,
            CancellationToken cancellation) =>
        {
            var first = await accounts.FindByIdAsync(request.UserA ?? "", cancellation);
            context.Audit().On(request.UserA, first?.Username).Detail =
                $"with {(await accounts.FindByIdAsync(request.UserB ?? "", cancellation))?.Username ?? request.UserB}";
            var madeBy = await accounts.FindByIdAsync(user.UserId(), cancellation);
            if (await friends.MakeFriendsAsync(request.UserA ?? "", request.UserB ?? "", madeBy, cancellation) is not { } id) return Results.NotFound();
            await invites.SettleAsync(cancellation);
            return Results.Ok(new { Id = id });
        }).RequirePermission(Permission.ManageUsers).Audited("admin.friends-made", targetRoute: null);

        admin.MapDelete("/friendships/{a}/{b}", async (
            string a, string b, Friends friends, Invites invites, IAccountStore accounts, HttpContext context, CancellationToken cancellation) =>
        {
            context.Audit().Detail = $"with {(await accounts.FindByIdAsync(b, cancellation))?.Username ?? b}";
            if (!await friends.EndFriendshipAsync(a, b, cancellation)) return Results.NotFound();
            await invites.SettleAsync(cancellation);
            return Results.NoContent();
        }).RequirePermission(Permission.ManageUsers).Audited("admin.friends-ended", "a");

        // Shared lists and groups someone owns, and handing them to another person.
        admin.MapGet("/users/{id}/shared", async (
            string id, ClaimsPrincipal user, IAccountStore accounts, Ownership ownership, CancellationToken cancellation) =>
            await OnAccountAsync(id, user, accounts, _ =>
                Task.FromResult(Results.Ok(ownership.SharedBy(id).Select(share => new AdminShare(share.Kind, share.Id, share.Name, share.People)).ToList())),
                cancellation))
            .RequirePermission(Permission.ManageUsers);

        admin.MapPost("/users/{id}/hand-over", async (
            string id, HandOverRequest request, ClaimsPrincipal user, Ownership ownership, IAccountStore accounts, HttpContext context,
            CancellationToken cancellation) =>
            await OnAccountAsync(id, user, accounts, async _ =>
            {
                if (request.To is null || await accounts.FindByIdAsync(request.To, cancellation) is not { } to) return Results.NotFound();
                var moved = await ownership.HandOverAsync(id, request.To, request.Ids, cancellation);
                context.Audit().Detail = $"{moved} to {to.Username}";
                return Results.Ok(new { Moved = moved });
            }, cancellation)).RequirePermission(Permission.ManageUsers).Audited("admin.shares-handed-over");

        // View the app as someone (super admins; spec: Account management, impersonation).
        admin.MapPost("/users/{id}/impersonate", async (
            string id, ImpersonationRequest request, ClaimsPrincipal user, Impersonations impersonations, HttpContext context,
            CancellationToken cancellation) =>
        {
            try
            {
                if (await impersonations.StartAsync(user.UserId(), id, request.Reason ?? "", cancellation) is not { } started)
                {
                    return Results.Json(new AdminError("not_allowed", "not yourself, nor a super admin, nor a turned-off account"),
                        statusCode: StatusCodes.Status409Conflict);
                }
                context.Audit().Detail = started.View.Reason;
                return Results.Ok(new ImpersonationStart(started.Token, started.View.Expires));
            }
            catch (ArgumentException error)
            {
                return Results.BadRequest(new AdminError("reason_required", error.Message));
            }
        }).RequirePermission(Permission.Impersonate).Audited("impersonation.started");

        // Invite links for self sign-up (spec: Registration).
        admin.MapGet("/invites", async (SelfSignUp signUp, SignupInvites invites, IAccountStore accounts, CancellationToken cancellation) =>
        {
            var names = await NamesAsync(accounts, cancellation);
            return new InviteList(signUp.InvitesWork ? signUp.Policy.ToString().ToLowerInvariant() : "closed",
                (await invites.ListAsync(cancellation)).Select(invite => View(invite, names)).ToList());
        }).RequirePermission(Permission.ManageUsers);

        admin.MapPost("/invites", async (
            InviteRequest request, ClaimsPrincipal user, SelfSignUp signUp, SignupInvites invites, IAccountStore accounts, HttpContext context,
            Core.Mail.IMailSender mail, LiveSettings live, CancellationToken cancellation) =>
        {
            context.Audit().On(null, request.Note);
            if (!signUp.InvitesWork) return Results.Conflict(new AdminError("registration_closed", "sign-up is closed (REGISTRATION=closed)"));
            var sendTo = string.IsNullOrWhiteSpace(request.SendTo) ? null : AccountEmails.Normalize(request.SendTo);
            if (!string.IsNullOrWhiteSpace(request.SendTo) && sendTo is null)
            {
                return Results.BadRequest(new AdminError("invalid_email", "that is not an email address"));
            }
            if (sendTo is not null && !EmailEndpoints.LinksWork(mail, live))
            {
                return Results.Conflict(new AdminError("mail_not_set_up", "Set up email and PUBLIC_URL first."));
            }
            try
            {
                var (token, invite) = await invites.CreateAsync(user.UserId(), TimeSpan.FromDays(request.Days ?? 7),
                    request.AnyNumber ? null : request.Uses ?? 1, request.Note, cancellation);
                context.Audit().On(invite.Id, invite.Note).Detail =
                    $"{(invite.MaxUses is { } most ? $"{most} {(most == 1 ? "person" : "people")}" : "any number of people")} until {invite.Expires:yyyy-MM-dd HH:mm}Z";
                var url = $"{ServerApp.Origin(context)}/join/{token}";
                var made = new NewInvite(url, View(invite, await NamesAsync(accounts, cancellation)));
                if (sendTo is null) return Results.Ok(made);
                try
                {
                    var from = (await accounts.FindByIdAsync(user.UserId(), cancellation))?.Username ?? "An admin";
                    await mail.SendAsync(Core.Mail.MailTemplates.Invite(sendTo, live.Current.PublicUrl?.Host ?? "your server", from, url, invite.Expires), cancellation);
                    context.Audit().Detail += $", emailed to {sendTo}";
                    return Results.Ok(made with { Sent = true });
                }
                catch (Core.Mail.MailException error)
                {
                    return Results.Ok(made with { Sent = false, MailProblem = error.Message });
                }
            }
            catch (ArgumentException error)
            {
                return Results.BadRequest(new AdminError("invalid", error.Message));
            }
        }).RequirePermission(Permission.ManageUsers).Audited("admin.invite-created", targetRoute: null);

        admin.MapDelete("/invites/{id}", async (string id, SignupInvites invites, HttpContext context, CancellationToken cancellation) =>
        {
            if (await invites.RevokeAsync(id, cancellation) is not { } invite) return Results.NotFound();
            context.Audit().On(invite.Id, invite.Note);
            return Results.NoContent();
        }).RequirePermission(Permission.ManageUsers).Audited("admin.invite-revoked", targetRoute: null);

        admin.MapGet("/pending-signins", async (IIdentityStore identities, CancellationToken cancellation) =>
            await identities.ListPendingAsync(cancellation)).RequirePermission(Permission.ManageUsers);

        admin.MapPost("/pending-signins/{provider}/{subject}/approve", async (
            string provider, string subject, ServerSettings settings, ExternalSignIn signIn, HttpContext context, CancellationToken cancellation) =>
        {
            context.Audit().Detail = provider;
            if (settings.Provider(provider) is not { } found) return Results.NotFound();
            if (await signIn.ApproveAsync(found, subject, cancellation) is not { } account) return Results.NotFound();
            context.Audit().On(account.Id, account.Username).Detail = $"{provider}, role {account.Role.Name()}";
            return Results.Ok(new { account.Id, account.Username, Role = account.Role.Name() });
        }).RequirePermission(Permission.ManageUsers).ProjectsServerGroups().Audited("admin.pending-approved", targetRoute: null);

        admin.MapDelete("/pending-signins/{provider}/{subject}", async (string provider, string subject, IIdentityStore identities, HttpContext context, CancellationToken cancellation) =>
        {
            var waiting = (await identities.ListPendingAsync(cancellation)).FirstOrDefault(each => each.Provider == provider && each.Subject == subject);
            context.Audit().On(null, waiting?.Username ?? subject).Detail = provider;
            return await identities.RemovePendingAsync(provider, subject, cancellation) ? Results.NoContent() : Results.NotFound();
        })
            .RequirePermission(Permission.ManageUsers).Audited("admin.pending-dismissed", targetRoute: null);

        admin.MapGet("/groups", async (ServerGroupService groups, CancellationToken cancellation) =>
            (await groups.ListAsync(cancellation)).Select(View)).RequirePermission(Permission.ManageGroups);

        admin.MapPost("/groups", async (GroupRequest request, ServerGroupService groups, HttpContext context, CancellationToken cancellation) =>
            await GroupResult(async () =>
            {
                context.Audit().On(null, request.Name);
                var group = await groups.CreateAsync(request.Name ?? "", request.OfferedForSharing ?? false, cancellation);
                context.Audit().On(group.Id, group.Name);
                return Results.Created($"/api/admin/groups/{group.Id}", View(new ServerGroupView(group, [])));
            })).RequirePermission(Permission.ManageGroups).ProjectsServerGroups().Audited("admin.group-created", targetRoute: null);

        admin.MapPatch("/groups/{id}", async (string id, GroupRequest request, ServerGroupService groups, HttpContext context, CancellationToken cancellation) =>
            await GroupResult(async () =>
            {
                context.Audit().Detail = string.Join(", ", new[]
                {
                    request.Name is null ? null : $"name {request.Name}",
                    request.OfferedForSharing is null ? null : $"offered for sharing {(request.OfferedForSharing == true ? "on" : "off")}",
                }.OfType<string>());
                await groups.UpdateAsync(id, request.Name, request.OfferedForSharing, cancellation);
                return Results.Ok((await groups.ListAsync(cancellation)).Where(view => view.Group.Id == id).Select(View).Single());
            })).RequirePermission(Permission.ManageGroups).ProjectsServerGroups().Audited("admin.group-changed", "id", AuditTarget.Group);

        admin.MapDelete("/groups/{id}", async (string id, ServerGroupService groups, IServerGroupStore store, HttpContext context, CancellationToken cancellation) =>
        {
            // Named now: it is gone by the time the entry is written.
            context.Audit().On(id, (await store.FindAsync(id, cancellation))?.Name);
            return await groups.DeleteAsync(id, cancellation) ? Results.NoContent() : Results.NotFound();
        })
            .RequirePermission(Permission.ManageGroups).ProjectsServerGroups().Audited("admin.group-deleted", "id", AuditTarget.Group);

        // Members added by hand; ones from an identity provider come and go with its sign-ins.
        admin.MapPut("/groups/{id}/members/{accountId}", (
            string id, string accountId, ServerGroupService groups, IServerGroupStore store, HttpContext context, CancellationToken cancellation) =>
            GroupResult(async () =>
            {
                context.Audit().Detail = (await store.FindAsync(id, cancellation))?.Name ?? id;
                await groups.SetManualMemberAsync(id, accountId, member: true, cancellation);
                return Results.NoContent();
            })).RequirePermission(Permission.ManageGroups).ProjectsServerGroups().Audited("admin.group-member-added", "accountId");

        admin.MapDelete("/groups/{id}/members/{accountId}", (
            string id, string accountId, ServerGroupService groups, IServerGroupStore store, HttpContext context, CancellationToken cancellation) =>
            GroupResult(async () =>
            {
                context.Audit().Detail = (await store.FindAsync(id, cancellation))?.Name ?? id;
                await groups.SetManualMemberAsync(id, accountId, member: false, cancellation);
                return Results.NoContent();
            })).RequirePermission(Permission.ManageGroups).ProjectsServerGroups().Audited("admin.group-member-removed", "accountId");

        return admin;
    }

    /// <summary>After a change to server groups, their members or accounts: the app's copies follow.</summary>
    private static RouteHandlerBuilder ProjectsServerGroups(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter(async (context, next) =>
        {
            var result = await next(context);
            await context.HttpContext.RequestServices.GetRequiredService<ServerGroupProjection>().ProjectAsync(context.HttpContext.RequestAborted);
            return result;
        });

    /// <summary>
    /// Run an action on someone else's account: 404 when there is none, and 403 when it is an admin's
    /// and the caller may not manage admins (spec: only super admins act on admins).
    /// </summary>
    internal static async Task<IResult> OnAccountAsync(
        string id, ClaimsPrincipal user, IAccountStore accounts, Func<Account, Task<IResult>> action, CancellationToken cancellation)
    {
        if (await accounts.FindByIdAsync(id, cancellation) is not { } account) return Results.NotFound();
        if (account.Role != Role.User && account.Id != user.UserId() && !user.AccountRole().Can(Permission.ManageAdmins))
        {
            return Results.Json(new AdminError("admins_only_by_super_admins"), statusCode: StatusCodes.Status403Forbidden);
        }
        return await action(account);
    }

    /// <summary>Usernames by account id, for naming people in answers.</summary>
    private static async Task<Dictionary<string, string>> NamesAsync(IAccountStore accounts, CancellationToken cancellation) =>
        (await accounts.ListAsync(cancellation)).ToDictionary(account => account.Id, account => account.Username);

    /// <summary>What the account service refuses, as answers: no such account (404), the last super admin or a taken name (409).</summary>
    private static async Task<IResult> AccountResult(Func<Task<IResult>> action)
    {
        try
        {
            return await action();
        }
        catch (KeyNotFoundException)
        {
            return Results.NotFound();
        }
        catch (LastSuperAdminException error)
        {
            return Results.Conflict(new AdminError("last_super_admin", error.Message));
        }
        catch (DuplicateUsernameException)
        {
            return Results.Conflict(new AdminError("username_taken"));
        }
    }

    private static AdminInvite View(SignupInvite invite, IReadOnlyDictionary<string, string> names) => new(
        invite.Id, invite.Note, names.GetValueOrDefault(invite.CreatedBy, invite.CreatedBy), invite.CreatedAt, invite.Expires,
        invite.MaxUses, invite.Uses, invite.UsedBy.Select(id => names.GetValueOrDefault(id, id)).ToList());

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
