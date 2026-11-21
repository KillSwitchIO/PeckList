using PeckList.Core.Configuration;
using PeckList.Core.Mail;
using PeckList.Server.Push;

namespace PeckList.Server.Tests;

/// <summary>
/// The contact a push names (the VAPID subject) is always https: or mailto:, which push services
/// require: an http PUBLIC_URL made every reminder push fail.
/// </summary>
public sealed class PushContactTests
{
    private static ServerSettings Settings(string? url, string? from = null) => new()
    {
        PublicUrl = url is null ? null : new Uri(url),
        Mail = from is null ? null : new MailSettings("smtp.example.com", 587, null, null, from, MailTls.StartTls),
    };

    [Theory]
    [InlineData("https://tasks.example.com/app/", null, "https://tasks.example.com")]
    [InlineData("https://tasks.example.com:8443", "PeckList <tasks@example.com>", "https://tasks.example.com:8443")]
    [InlineData("http://tasks.example.com", "PeckList <tasks@example.com>", "mailto:tasks@example.com")]
    [InlineData("http://10.0.0.5:8080", "tasks@example.com", "mailto:tasks@example.com")]
    [InlineData("http://tasks.example.com", null, PushSender.PlaceholderContact)]
    [InlineData("https://localhost:8443", "tasks@example.com", "mailto:tasks@example.com")]
    [InlineData("https://127.0.0.1", null, PushSender.PlaceholderContact)]
    [InlineData(null, "tasks@example.com", "mailto:tasks@example.com")]
    [InlineData(null, null, PushSender.PlaceholderContact)]
    public void The_contact_is_https_or_mailto(string? url, string? from, string contact)
    {
        Assert.Equal(contact, PushSender.Contact(Settings(url, from)));
    }

    [Fact]
    public void An_http_public_url_gets_one_startup_warning_naming_the_contact()
    {
        var withMail = PushContactCheck.Warning(Settings("http://tasks.example.com", "tasks@example.com"));
        Assert.NotNull(withMail);
        Assert.Contains("PUBLIC_URL is not https", withMail);
        Assert.Contains("mailto:tasks@example.com", withMail);
        Assert.DoesNotContain("SMTP_FROM", withMail);

        var without = PushContactCheck.Warning(Settings("http://tasks.example.com"));
        Assert.Contains(PushSender.PlaceholderContact, without);
        Assert.Contains("set SMTP_FROM", without);
    }

    [Theory]
    [InlineData("https://tasks.example.com")]
    [InlineData(null)]
    public void An_https_or_unset_public_url_gets_no_warning(string? url)
    {
        Assert.Null(PushContactCheck.Warning(Settings(url)));
    }
}
