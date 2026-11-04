using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace PeckList.Server.Tests;

/// <summary>Sending email (PL-122): the SMTP adapter against a fake mail server, and the admin's test email.</summary>
public sealed class MailTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server(params (string Key, string Value)[] extra) =>
        fixture.Factory([("ADMIN_PASSWORD", AdminPassword), .. extra]);

    private static (string, string)[] Smtp(int port) =>
    [
        ("SMTP_HOST", "127.0.0.1"),
        ("SMTP_PORT", port.ToString(System.Globalization.CultureInfo.InvariantCulture)),
        ("SMTP_TLS", "none"),
        ("SMTP_FROM", "PeckList <tasks@example.com>"),
        ("PUBLIC_URL", "https://tasks.example.com"),
    ];

    private static async Task<HttpClient> Admin(WebApplicationFactory<Program> server)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    [Fact]
    public async Task The_admins_test_email_goes_out_through_the_mail_server()
    {
        await using var smtp = new FakeSmtpServer();
        using var server = Server(Smtp(smtp.Port));
        var admin = await Admin(server);
        var response = await admin.PostAsJsonAsync("/api/admin/mail/test", new { to = "ben@example.com" }, Token);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var message = Assert.Single(smtp.Messages);
        Assert.Contains("Subject: Test email from PeckList on tasks.example.com", message);
        Assert.Contains("To: ben@example.com", message);
        Assert.Contains("From: PeckList <tasks@example.com>", message);
    }

    [Fact]
    public async Task A_refusal_or_no_mail_server_comes_back_in_words()
    {
        await using var refusing = new FakeSmtpServer(refuseRecipients: true);
        using (var server = Server(Smtp(refusing.Port)))
        {
            var response = await (await Admin(server)).PostAsJsonAsync("/api/admin/mail/test", new { to = "ben@example.com" }, Token);
            Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
            Assert.Contains("relay denied", (await response.Content.ReadFromJsonAsync<AdminError>(Token))!.Message);
        }
        using (var server = Server())
        {
            var response = await (await Admin(server)).PostAsJsonAsync("/api/admin/mail/test", new { to = "ben@example.com" }, Token);
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        }
    }

    [Fact]
    public async Task Email_saved_on_the_settings_page_works_at_once()
    {
        await using var smtp = new FakeSmtpServer();
        using var server = Server(("PUBLIC_URL", "https://tasks.example.com"));
        var admin = await Admin(server);
        var saved = await admin.PutAsJsonAsync("/api/admin/settings", new
        {
            values = new Dictionary<string, string?>
            {
                ["SMTP_PROVIDER"] = "custom",
                ["SMTP_HOST"] = "127.0.0.1",
                ["SMTP_PORT"] = smtp.Port.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["SMTP_TLS"] = "none",
                ["SMTP_FROM"] = "PeckList <tasks@example.com>",
            },
        }, Token);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var response = await admin.PostAsJsonAsync("/api/admin/mail/test", new { to = "ben@example.com" }, Token);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Single(smtp.Messages);
    }

    [Fact]
    public async Task A_provider_saved_on_the_settings_page_with_a_login_is_set_up()
    {
        using var server = Server(("PUBLIC_URL", "https://tasks.example.com"));
        var admin = await Admin(server);
        var saved = await admin.PutAsJsonAsync("/api/admin/settings", new
        {
            values = new Dictionary<string, string?>
            {
                ["SMTP_PROVIDER"] = "gmail",
                ["SMTP_USER"] = "ben@gmail.com",
                ["SMTP_PASSWORD"] = "abcd efgh ijkl mnop",
            },
        }, Token);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var mail = server.Services.GetRequiredService<PeckList.Core.Configuration.LiveSettings>().Current.Mail;
        Assert.NotNull(mail);
        Assert.Equal(("smtp.gmail.com", "PeckList <ben@gmail.com>"), (mail.Host, mail.From));
    }

    [Fact]
    public async Task Only_admins_send_test_email()
    {
        await using var smtp = new FakeSmtpServer();
        using var server = Server(Smtp(smtp.Port));
        var anonymous = server.CreateClient();
        var response = await anonymous.PostAsJsonAsync("/api/admin/mail/test", new { to = "ben@example.com" }, Token);
        Assert.True(response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden);
        Assert.Empty(smtp.Messages);
    }
}
