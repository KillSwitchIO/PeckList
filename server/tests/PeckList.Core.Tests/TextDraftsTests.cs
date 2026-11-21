using PeckList.Core.Text;

namespace PeckList.Core.Tests;

/// <summary>
/// The server's German, Spanish and French machine drafts (PL-148 piece 7): embedded, picked by
/// their tags, and filled like English. Parity with English is check:i18n's job.
/// </summary>
public class TextDraftsTests
{
    private static readonly JsonTextCatalog Catalog = JsonTextCatalog.Embedded;

    private static Dictionary<string, object?> Args(params (string Name, object? Value)[] args) =>
        args.ToDictionary(each => each.Name, each => each.Value, StringComparer.Ordinal);

    [Fact]
    public void The_server_speaks_german_spanish_and_french()
    {
        Assert.Equal(["en", "de", "es", "fr"], Catalog.Languages);
        Assert.Equal("de", Catalog.Resolve(["de-AT"]));
        Assert.Equal("es", Catalog.Resolve(["es-MX", "en"]));
        Assert.Equal("fr", Catalog.Resolve(["fr-CA"]));
    }

    [Theory]
    [InlineData("de", "Sam hat dir Steuer zugewiesen")]
    [InlineData("es", "Sam te asignó Steuer")]
    [InlineData("fr", "Sam vous a assigné Steuer")]
    public void A_notification_reads_in_the_language(string language, string expected) =>
        Assert.Equal(expected, Catalog.Text(language, "notify.assigned", Args(("actor", "Sam"), ("task", "Steuer"))));

    [Theory]
    [InlineData("de", 1, "1 Stunde")]
    [InlineData("de", 3, "3 Stunden")]
    [InlineData("es", 1, "1 hora")]
    [InlineData("fr", 2, "2 heures")]
    public void Plurals_follow_the_language(string language, int count, string expected) =>
        Assert.Equal(expected, Catalog.Text(language, "mail.reset.hours", Args(("count", count))));

    [Fact]
    public void Day_and_month_names_come_from_the_drafts()
    {
        Assert.Equal("März", Catalog.Text("de", "date.month.3"));
        Assert.Equal("miércoles", Catalog.Text("es", "date.weekday.3"));
        Assert.Equal("août", Catalog.Text("fr", "date.month.8"));
    }
}
