using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>An email on the account, confirmed by a link, and password reset links (PL-122).</summary>
public sealed partial class EmailLinkTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server(FakeSmtpServer? smtp, params (string Key, string Value)[] extra) =>
        fixture.Factory([("ADMIN_PASSWORD", AdminPassword), .. smtp is null ? [] : Smtp(smtp.Port), ("PUBLIC_URL", "https://tasks.example.com"), .. extra]);

    private WebApplicationFactory<Program> WithoutPublicUrl(FakeSmtpServer smtp) =>
        fixture.Factory([("ADMIN_PASSWORD", AdminPassword), .. Smtp(smtp.Port)]);

    private static (string, string)[] Smtp(int port) =>
    [
        ("SMTP_HOST", "127.0.0.1"),
        ("SMTP_PORT", port.ToString(System.Globalization.CultureInfo.InvariantCulture)),
        ("SMTP_TLS", "none"),
        ("SMTP_FROM", "PeckList <tasks@example.com>"),
    ];

    private static async Task<HttpClient> LogIn(WebApplicationFactory<Program> server, string username, string password)
    {
        var client = server.Browser(allowAutoRedirect: false);
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<(HttpClient Client, string Id)> NewUser(WebApplicationFactory<Program> server, string username)
    {
        var account = await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, Password, mustChangePassword: false, cancellation: Token);
        return (await LogIn(server, username, Password), account.Id);
    }

    /// <summary>The next message after the first <paramref name="seen"/>, decoded: its subject, recipient and text.</summary>
    private static async Task<(string Subject, string To, string Text)> NextMail(FakeSmtpServer smtp, int seen)
    {
        for (var wait = 0; wait < 100 && smtp.Messages.Count <= seen; wait++) await Task.Delay(50, Token);
        Assert.True(smtp.Messages.Count > seen, "no email arrived");
        var message = await MimeKit.MimeMessage.LoadAsync(new MemoryStream(Encoding.UTF8.GetBytes(smtp.Messages[seen])), Token);
        return (message.Subject ?? "", message.To.Mailboxes.Single().Address, message.TextBody ?? "");
    }

    [GeneratedRegex(@"https://tasks\.example\.com(/\S+)")]
    private static partial Regex LinkIn();

    private static string PathIn(string text) => LinkIn().Match(text) is { Success: true } match ? match.Groups[1].Value : throw new Xunit.Sdk.XunitException($"no link in: {text}");

    /// <summary>Sam, with sam@example.com set and confirmed through the link.</summary>
    private static async Task<(HttpClient Sam, string Id)> ConfirmedSam(WebApplicationFactory<Program> server, FakeSmtpServer smtp)
    {
        var (sam, id) = await NewUser(server, "sam");
        var seen = smtp.Messages.Count;
        var set = await (await sam.PutAsJsonAsync("/api/account/email", new { email = " Sam@Example.com " }, Token))
            .Content.ReadFromJsonAsync<AccountEmailView>(Token);
        Assert.Equal(new AccountEmailView("sam@example.com", false, true, Sent: true), set);
        var mail = await NextMail(smtp, seen);
        Assert.Equal(("Confirm your email for PeckList on tasks.example.com", "sam@example.com"), (mail.Subject, mail.To));
        var confirmed = await sam.GetAsync(PathIn(mail.Text), Token);
        Assert.Equal("/settings?email=confirmed", confirmed.Headers.Location!.OriginalString);
        Assert.True((await sam.GetFromJsonAsync<AccountEmailView>("/api/account/email", Token))!.Confirmed);
        return (sam, id);
    }

    [Fact]
    public async Task A_forgotten_password_is_reset_by_a_link_that_works_once_and_ends_every_session()
    {
        await using var smtp = new FakeSmtpServer();
        using var server = Server(smtp);
        var (sam, _) = await ConfirmedSam(server, smtp);
        var options = await server.CreateClient().GetFromJsonAsync<JsonObject>("/auth/providers", Token);
        Assert.True((bool)options!["passwordReset"]!);

        var stranger = server.CreateClient();
        var seen = smtp.Messages.Count;
        Assert.Equal(HttpStatusCode.Accepted, (await stranger.PostAsJsonAsync("/auth/forgot", new { login = "SAM" }, Token)).StatusCode);
        var mail = await NextMail(smtp, seen);
        Assert.Equal(("Reset your PeckList password on tasks.example.com", "sam@example.com"), (mail.Subject, mail.To));
        var path = PathIn(mail.Text);
        Assert.StartsWith("/reset/", path);
        var token = path["/reset/".Length..];

        Assert.Equal("sam", (await stranger.GetFromJsonAsync<ResetLinkInfo>($"/auth/reset/{token}", Token))!.Username);
        var tooShort = await stranger.PostAsJsonAsync("/auth/reset", new { token, password = "short" }, Token);
        Assert.Equal(HttpStatusCode.BadRequest, tooShort.StatusCode);
        var reset = await stranger.PostAsJsonAsync("/auth/reset", new { token, password = "a brand new password" }, Token);
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        // The old session is over, the new password works, the link is spent.
        Assert.Equal(HttpStatusCode.Unauthorized, (await sam.GetAsync("/api/account/email", Token)).StatusCode);
        await LogIn(server, "sam", "a brand new password");
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync("/auth/reset", new { token, password = "yet another password" }, Token)).StatusCode);
    }

    [Fact]
    public async Task Asking_for_a_reset_answers_the_same_whoever_is_asked_for_and_mails_only_confirmed_emails()
    {
        await using var smtp = new FakeSmtpServer();
        using var server = Server(smtp);
        var (kim, _) = await NewUser(server, "kim");
        await kim.PutAsJsonAsync("/api/account/email", new { email = "kim@example.com" }, Token);
        await NextMail(smtp, 0);
        var stranger = server.CreateClient();
        foreach (var login in new[] { "nobody", "kim", "kim@example.com", "nobody@example.com" })
        {
            var answer = await stranger.PostAsJsonAsync("/auth/forgot", new { login }, Token);
            Assert.Equal(HttpStatusCode.Accepted, answer.StatusCode);
            Assert.Equal("", await answer.Content.ReadAsStringAsync(Token));
        }
        // Kim never confirmed: only the confirmation email went out.
        await Task.Delay(1000, Token);
        Assert.Single(smtp.Messages);
    }

    [Fact]
    public async Task Without_email_or_a_public_address_there_is_no_forgot_password()
    {
        using (var server = Server(null))
        {
            var client = server.CreateClient();
            Assert.False((bool)(await client.GetFromJsonAsync<JsonObject>("/auth/providers", Token))!["passwordReset"]!);
            Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/auth/forgot", new { login = "admin" }, Token)).StatusCode);
        }
        await using var smtp = new FakeSmtpServer();
        // Email set up, but links would have to come from the address a request came in on.
        using (var server = WithoutPublicUrl(smtp))
        {
            Assert.False((bool)(await server.CreateClient().GetFromJsonAsync<JsonObject>("/auth/providers", Token))!["passwordReset"]!);
        }
    }

    [Fact]
    public async Task An_admin_sends_a_reset_link_to_a_confirmed_email_only()
    {
        await using var smtp = new FakeSmtpServer();
        using var server = Server(smtp);
        var (_, samId) = await ConfirmedSam(server, smtp);
        var (_, kimId) = await NewUser(server, "kim");
        var admin = await LogIn(server, "admin", AdminPassword);

        var users = await admin.GetFromJsonAsync<AdminUser[]>("/api/admin/users", Token);
        var sam = users!.Single(user => user.Id == samId);
        Assert.Equal(("sam@example.com", true), (sam.Email, sam.EmailConfirmed));

        var seen = smtp.Messages.Count;
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/admin/users/{samId}/reset-link", null, Token)).StatusCode);
        Assert.StartsWith("/reset/", PathIn((await NextMail(smtp, seen)).Text));
        var none = await admin.PostAsync($"/api/admin/users/{kimId}/reset-link", null, Token);
        Assert.Equal(HttpStatusCode.Conflict, none.StatusCode);
        Assert.Equal("no_confirmed_email", (await none.Content.ReadFromJsonAsync<AdminError>(Token))!.Error);
    }

    [Fact]
    public async Task A_changed_email_needs_confirming_again_and_an_old_link_no_longer_confirms()
    {
        await using var smtp = new FakeSmtpServer();
        using var server = Server(smtp);
        var (sam, _) = await ConfirmedSam(server, smtp);
        var seen = smtp.Messages.Count;
        await sam.PutAsJsonAsync("/api/account/email", new { email = "sam@work.example" }, Token);
        var first = PathIn((await NextMail(smtp, seen)).Text);
        Assert.False((await sam.GetFromJsonAsync<AccountEmailView>("/api/account/email", Token))!.Confirmed);
        await sam.PutAsJsonAsync("/api/account/email", new { email = "sam@home.example" }, Token);
        Assert.Equal("/settings?email=expired", (await sam.GetAsync(first, Token)).Headers.Location!.OriginalString);
        Assert.Equal(HttpStatusCode.BadRequest, (await sam.PutAsJsonAsync("/api/account/email", new { email = "not an email" }, Token)).StatusCode);
        var removed = await (await sam.PutAsJsonAsync("/api/account/email", new { email = "" }, Token)).Content.ReadFromJsonAsync<AccountEmailView>(Token);
        Assert.Null(removed!.Email);
    }

    [Fact]
    public async Task An_invite_can_go_out_by_email()
    {
        await using var smtp = new FakeSmtpServer();
        using var server = Server(smtp, ("REGISTRATION", "invite"));
        var admin = await LogIn(server, "admin", AdminPassword);
        var made = await (await admin.PostAsJsonAsync("/api/admin/invites", new { sendTo = "friend@example.com" }, Token))
            .Content.ReadFromJsonAsync<NewInvite>(Token);
        Assert.True(made!.Sent);
        var mail = await NextMail(smtp, 0);
        Assert.Equal(("You're invited to PeckList on tasks.example.com", "friend@example.com"), (mail.Subject, mail.To));
        Assert.Equal(made.Url, "https://tasks.example.com" + PathIn(mail.Text));
    }
}
