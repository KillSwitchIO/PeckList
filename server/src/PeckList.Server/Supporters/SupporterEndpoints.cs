using System.Globalization;
using System.Security.Claims;
using PeckList.Core.Accounts;
using PeckList.Core.Audit;
using PeckList.Core.Supporters;
using PeckList.Server.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server.Supporters;

public sealed record SupporterKeyRequest(string? Key);

/// <summary>What a supporter key says: when it was bought and whom it covers (<c>person</c> or <c>server</c>). Never the key itself.</summary>
public sealed record SupporterKeyView(DateOnly Purchased, string Kind)
{
    public static SupporterKeyView? Of(SupporterKey? key) =>
        key is null ? null : new(key.Purchased, key.Kind == SupporterKind.Person ? "person" : "server");
}

/// <summary>Your own supporter key and the server's: either one makes you a supporter here.</summary>
public sealed record SupporterView(SupporterKeyView? Mine, SupporterKeyView? Server);

/// <summary>The server's supporter key, if it has one.</summary>
public sealed record ServerSupporterView(SupporterKeyView? Key);

/// <summary>
/// <c>/api/account/supporter</c> and <c>/api/admin/supporter</c> (PL-112): entering a supporter key
/// bought on the website. A key is checked offline, here, and only says thank you: nothing else in
/// PeckList asks about it. Answers never repeat a key back, and the event log records its serial and
/// date, not the key.
/// </summary>
public static class SupporterEndpoints
{
    public static IServiceCollection AddSupporterKeys(this IServiceCollection services) => services
        .AddSingleton<ISupporterKeyCheck>(SupporterKeyCheck.FromBase64(SupporterKeyCheck.BuiltIn))
        .AddSingleton<SupporterKeys>();

    private static IResult Refused(SupporterEntry result, SupporterKind wanted) => Results.BadRequest(result switch
    {
        SupporterEntry.NotAKey => new AdminError("not_a_key", "That isn't a supporter key. Paste the whole key from your email, starting with PECKLIST-."),
        SupporterEntry.NotGenuine => new AdminError("not_genuine", "That key wasn't issued by PeckList."),
        _ when wanted == SupporterKind.Person => new AdminError("server_key", "That's a server key. An admin enters it under Admin > Support."),
        _ => new AdminError("person_key", "That's a key for one person. Enter it under Settings > Support PeckList."),
    });

    private static string Note(SupporterKey key) =>
        $"{key.Purchased.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)} {key.SerialText}";

    public static RouteGroupBuilder MapAccountSupporter(this RouteGroupBuilder api)
    {
        api.MapGet("/account/supporter", async (ClaimsPrincipal user, SupporterKeys keys, CancellationToken cancellation) =>
            new SupporterView(SupporterKeyView.Of(await keys.PersonAsync(user.UserId(), cancellation)), SupporterKeyView.Of(await keys.ServerAsync(cancellation))))
            .Doc<SupporterView>("Your supporter key and the server's, if there are any (what they say, never the keys)");

        api.MapPut("/account/supporter", async (SupporterKeyRequest request, ClaimsPrincipal user, SupporterKeys keys, HttpContext context,
            CancellationToken cancellation) =>
        {
            // Viewing as someone never changes their account (audit C4).
            if (user.Impersonator() is not null) return Results.Json(new AuthError("not_while_impersonating"), statusCode: StatusCodes.Status403Forbidden);
            var (result, key) = await keys.EnterAsync(user.UserId(), request.Key, cancellation);
            if (result != SupporterEntry.Saved)
            {
                context.Audit().Outcome = AuditOutcome.Failed;
                return Refused(result, SupporterKind.Person);
            }
            context.Audit().Detail = Note(key!);
            return Results.Ok(new SupporterView(SupporterKeyView.Of(key), SupporterKeyView.Of(await keys.ServerAsync(cancellation))));
        }).Doc<SupporterView>("Enter your own supporter key").Refuses(StatusCodes.Status400BadRequest, StatusCodes.Status403Forbidden)
            .Audited("account.supporter-key-entered", targetRoute: null);

        api.MapDelete("/account/supporter", async (ClaimsPrincipal user, SupporterKeys keys, CancellationToken cancellation) =>
        {
            if (user.Impersonator() is not null) return Results.Json(new AuthError("not_while_impersonating"), statusCode: StatusCodes.Status403Forbidden);
            await keys.RemoveAsync(user.UserId(), cancellation);
            return Results.NoContent();
        }).Doc("Remove your supporter key from this server").Refuses(StatusCodes.Status403Forbidden)
            .Audited("account.supporter-key-removed", targetRoute: null);

        return api;
    }

    public static RouteGroupBuilder MapAdminSupporter(this RouteGroupBuilder admin)
    {
        admin.MapGet("/supporter", async (SupporterKeys keys, CancellationToken cancellation) =>
            new ServerSupporterView(SupporterKeyView.Of(await keys.ServerAsync(cancellation))))
            .Doc<ServerSupporterView>("The server's supporter key, if it has one (what it says, never the key)").RequirePermission(Permission.ManageSettings);

        admin.MapPut("/supporter", async (SupporterKeyRequest request, SupporterKeys keys, HttpContext context, CancellationToken cancellation) =>
        {
            var (result, key) = await keys.EnterAsync(null, request.Key, cancellation);
            if (result != SupporterEntry.Saved)
            {
                context.Audit().Outcome = AuditOutcome.Failed;
                return Refused(result, SupporterKind.Server);
            }
            context.Audit().Detail = Note(key!);
            return Results.Ok(new ServerSupporterView(SupporterKeyView.Of(key)));
        }).Doc<ServerSupporterView>("Enter a server supporter key, which covers everyone here").Refuses(StatusCodes.Status400BadRequest)
            .RequirePermission(Permission.ManageSettings).Audited("admin.supporter-key-entered", targetRoute: null);

        admin.MapDelete("/supporter", async (SupporterKeys keys, CancellationToken cancellation) =>
        {
            await keys.RemoveAsync(null, cancellation);
            return Results.NoContent();
        }).Doc("Remove the server's supporter key").RequirePermission(Permission.ManageSettings)
            .Audited("admin.supporter-key-removed", targetRoute: null);

        return admin;
    }
}
