using System.Security.Claims;
using Punchlist.Core.Accounts;
using Punchlist.Core.Configuration;
using Punchlist.Core.Sharing;
using Punchlist.Server.Auth;

namespace Punchlist.Server;

public sealed record FriendCode(string Code, string Link);

public sealed record FriendshipAccepted(string FriendshipId);

/// <summary>Friend codes and links, accepting a link, and looking someone up.</summary>
public static class FriendEndpoints
{
    public static RouteGroupBuilder MapFriends(this RouteGroupBuilder api)
    {
        api.MapGet("/friends/code", async (ClaimsPrincipal user, Friends friends, HttpContext context, CancellationToken cancellation) =>
            Code(context, await friends.CodeAsync(user.UserId(), cancellation: cancellation)));

        // A new code: links shared before stop working.
        api.MapPost("/friends/code", async (ClaimsPrincipal user, Friends friends, HttpContext context, CancellationToken cancellation) =>
            Code(context, await friends.CodeAsync(user.UserId(), rotate: true, cancellation)));

        api.MapGet("/friends/link/{code}", async (string code, ClaimsPrincipal user, Friends friends, CancellationToken cancellation) =>
            await friends.PreviewByCodeAsync(user.UserId(), code, cancellation) is { } preview ? Results.Ok(preview) : Results.NotFound());

        api.MapPost("/friends/link/{code}", async (string code, ClaimsPrincipal user, Friends friends, Invites invites, CancellationToken cancellation) =>
        {
            if (await friends.AcceptLinkAsync(user.UserId(), code, cancellation) is not { } id) return Results.NotFound();
            await invites.SettleAsync(cancellation);
            return Results.Ok(new FriendshipAccepted(id));
        });

        api.MapGet("/users/lookup", async (string q, ClaimsPrincipal user, Friends friends, CancellationToken cancellation) =>
            await friends.LookupAsync(user.UserId(), q, cancellation) is { } preview ? Results.Ok(preview) : Results.NotFound());

        return api;
    }

    private static FriendCode Code(HttpContext context, string code)
    {
        return new FriendCode(code, $"{ServerApp.Origin(context)}/f/{code}");
    }

    /// <summary>The account's profile is written on its first sync (cheap after that: the index has it).</summary>
    public static RouteGroupBuilder EnsureProfiles(this RouteGroupBuilder api) =>
        api.AddEndpointFilter(async (context, next) =>
        {
            var services = context.HttpContext.RequestServices;
            if (context.HttpContext.User.Identity?.IsAuthenticated == true
                && !services.GetRequiredService<SharingState>().Index.Contains(context.HttpContext.User.UserId())
                && await services.GetRequiredService<IAccountStore>().FindByIdAsync(context.HttpContext.User.UserId()) is { } account)
            {
                await services.GetRequiredService<Friends>().EnsureProfileAsync(account, context.HttpContext.RequestAborted);
            }
            return await next(context);
        });
}
