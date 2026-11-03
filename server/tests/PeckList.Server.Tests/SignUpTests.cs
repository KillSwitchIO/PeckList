using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>People making their own account (spec: Registration), through the API.</summary>
public sealed class SignUpTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server(string? registration = null) =>
        registration is null
            ? fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()))
            : fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()), ("REGISTRATION", registration));

    private static async Task<HttpClient> Admin(WebApplicationFactory<Program> server)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static Task<HttpResponseMessage> SignUp(HttpClient client, string username, string password = Password, string? invite = null) =>
        client.PostAsJsonAsync("/auth/signup", new { username, password, invite }, Token);

    private static async Task<string?> ErrorOf(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<AuthError>(Token))?.Error;

    private static string TokenOf(NewInvite invite) => invite.Url[(invite.Url.LastIndexOf('/') + 1)..];

    [Fact]
    public async Task Invite_only_by_default_an_invite_link_lets_one_person_in()
    {
        using var server = Server();
        var stranger = server.CreateClient();
        var refused = await SignUp(stranger, "sam");
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("invite_required", await ErrorOf(refused));
        Assert.Equal("invite", (await stranger.GetFromJsonAsync<SignInOptions>("/auth/providers", Token))!.Registration);

        var admin = await Admin(server);
        var created = await admin.PostAsJsonAsync("/api/admin/invites", new { days = 3, note = "Sam" }, Token);
        var invite = (await created.Content.ReadFromJsonAsync<NewInvite>(Token))!;
        Assert.StartsWith("http://localhost/join/", invite.Url);
        Assert.Equal("Sam", invite.Invite.Note);
        Assert.Equal("admin", invite.Invite.CreatedBy);
        Assert.Equal(1, invite.Invite.MaxUses);

        var check = await stranger.GetAsync($"/auth/invites/{TokenOf(invite)}", Token);
        Assert.Equal(HttpStatusCode.OK, check.StatusCode);
        Assert.Equal(invite.Invite.Expires, (await check.Content.ReadFromJsonAsync<InviteCheck>(Token))!.Expires);

        var joined = await SignUp(stranger, "Sam", invite: TokenOf(invite));
        Assert.Equal(HttpStatusCode.OK, joined.StatusCode);
        var me = await stranger.GetFromJsonAsync<Me>("/auth/me", Token);
        Assert.Equal("sam", me!.Username);
        Assert.Equal("user", me.Role);
        Assert.False(me.MustChangePassword);
        Assert.Equal(HttpStatusCode.OK, (await stranger.GetAsync("/api/account/sign-in", Token)).StatusCode);

        // Used up: the link stops working and leaves the admin's list.
        Assert.Equal("invite_invalid", await ErrorOf(await SignUp(server.CreateClient(), "kim", invite: TokenOf(invite))));
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/auth/invites/{TokenOf(invite)}", Token)).StatusCode);
        Assert.Empty((await admin.GetFromJsonAsync<InviteList>("/api/admin/invites", Token))!.Invites);
    }

    [Fact]
    public async Task Open_servers_let_anyone_sign_up_with_a_good_name_and_password()
    {
        using var server = Server("open");
        var client = server.CreateClient();
        Assert.Equal("open", (await client.GetFromJsonAsync<SignInOptions>("/auth/providers", Token))!.Registration);
        Assert.Equal("invalid_username", await ErrorOf(await SignUp(client, "Sam Smith!")));
        Assert.Equal("too_short", await ErrorOf(await SignUp(client, "sam", "short")));
        var taken = await SignUp(client, "admin");
        Assert.Equal(HttpStatusCode.Conflict, taken.StatusCode);
        Assert.Equal("username_taken", await ErrorOf(taken));
        Assert.Equal(HttpStatusCode.OK, (await SignUp(client, "sam")).StatusCode);

        var other = server.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await other.PostAsJsonAsync("/auth/login", new { username = "sam", password = Password }, Token)).StatusCode);
    }

    [Fact]
    public async Task Closed_servers_refuse_sign_ups_and_make_no_invites()
    {
        using var server = Server("closed");
        var client = server.CreateClient();
        Assert.Equal("closed", (await client.GetFromJsonAsync<SignInOptions>("/auth/providers", Token))!.Registration);
        var refused = await SignUp(client, "sam");
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("registration_closed", await ErrorOf(refused));

        var admin = await Admin(server);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync("/api/admin/invites", new { }, Token)).StatusCode);
        Assert.Equal("closed", (await admin.GetFromJsonAsync<InviteList>("/api/admin/invites", Token))!.Registration);
    }

    [Fact]
    public async Task Admins_list_and_revoke_invites_and_see_who_used_them()
    {
        using var server = Server();
        var admin = await Admin(server);
        var team = (await (await admin.PostAsJsonAsync("/api/admin/invites", new { uses = 3, note = "Team" }, Token))
            .Content.ReadFromJsonAsync<NewInvite>(Token))!;
        var spare = (await (await admin.PostAsJsonAsync("/api/admin/invites", new { anyNumber = true, days = 1 }, Token))
            .Content.ReadFromJsonAsync<NewInvite>(Token))!;
        Assert.Null(spare.Invite.MaxUses);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/admin/invites", new { days = 400 }, Token)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await SignUp(server.CreateClient(), "ana", invite: TokenOf(team))).StatusCode);
        var list = (await admin.GetFromJsonAsync<InviteList>("/api/admin/invites", Token))!;
        Assert.Equal("invite", list.Registration);
        Assert.Equal([spare.Invite.Id, team.Invite.Id], list.Invites.Select(invite => invite.Id));
        var used = list.Invites.Single(invite => invite.Id == team.Invite.Id);
        Assert.Equal(1, used.Uses);
        Assert.Equal(["ana"], used.UsedBy);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/admin/invites/{spare.Invite.Id}", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync($"/api/admin/invites/{spare.Invite.Id}", Token)).StatusCode);
        Assert.Equal("invite_invalid", await ErrorOf(await SignUp(server.CreateClient(), "bo", invite: TokenOf(spare))));
    }

    [Fact]
    public async Task No_sign_up_without_accounts()
    {
        using var server = fixture.Factory(("AUTH_MODE", "none"), ("DB_PATH", fixture.NewDbPath()), ("REGISTRATION", "open"));
        Assert.Equal(HttpStatusCode.NotFound, (await SignUp(server.CreateClient(), "sam")).StatusCode);
    }
}
