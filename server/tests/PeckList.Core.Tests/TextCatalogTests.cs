using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using PeckList.Core.Push;
using PeckList.Core.Text;

namespace PeckList.Core.Tests;

/// <summary>
/// What every <see cref="ITextCatalog"/> must do (PL-148), whatever reads the messages: pick the
/// language, fall back per key, follow each language's plural rules, and never throw into a mail or
/// a push.
/// </summary>
public abstract class TextCatalogContract
{
    /// <summary>A catalog of these languages (English among them).</summary>
    protected abstract ITextCatalog Make(IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> catalogs);

    private static readonly Dictionary<string, string> English = new()
    {
        ["hello"] = "Hello {name}",
        ["hours"] = "{count, plural, one {# hour} other {# hours}}",
        ["exactly"] = "{count, plural, =1 {one hour} other {# hours}}",
        ["only.english"] = "Only in English",
        ["invited"] = "You're invited to {server}",
        ["owner"] = "{actor}'s list",
        ["kind"] = "{kind, select, starts {Starts} other {Due}}",
        ["broken"] = "{count, plural, one {# task}",
    };

    private ITextCatalog Catalog() => Make(new Dictionary<string, IReadOnlyDictionary<string, string>>
    {
        ["en"] = English,
        ["pl"] = new Dictionary<string, string> { ["hello"] = "Cześć {name}", ["hours"] = "{count, plural, one {# godzina} few {# godziny} many {# godzin} other {# godziny}}" },
        ["ru"] = new Dictionary<string, string> { ["hours"] = "{count, plural, one {# час} few {# часа} many {# часов} other {# часа}}" },
        ["ja"] = new Dictionary<string, string> { ["hello"] = "こんにちは {name}" },
        ["pt-BR"] = new Dictionary<string, string> { ["hello"] = "Olá {name}" },
    });

    private static Dictionary<string, object?> Args(params (string Name, object? Value)[] args) =>
        args.ToDictionary(each => each.Name, each => each.Value, StringComparer.Ordinal);

    [Fact]
    public void Languages_list_english_first()
    {
        var languages = Catalog().Languages;
        Assert.Equal("en", languages[0]);
        Assert.Equal(["en", "ja", "pl", "pt-BR", "ru"], languages);
    }

    [Fact]
    public void Resolve_takes_the_first_wanted_language_it_has_exact_then_base_else_english()
    {
        var catalog = Catalog();
        Assert.Equal("pl", catalog.Resolve(["pl-PL"]));
        Assert.Equal("pt-BR", catalog.Resolve(["pt-br"]));
        Assert.Equal("pt-BR", catalog.Resolve(["pt_BR"]));
        // A base language does not reach a regional one.
        Assert.Equal("en", catalog.Resolve(["pt"]));
        Assert.Equal("ja", catalog.Resolve(["fr-CA", null, " ", "ja-JP", "pl"]));
        Assert.Equal("en", catalog.Resolve(["de", "fr"]));
        Assert.Equal("en", catalog.Resolve([]));
    }

    [Fact]
    public void A_key_the_language_lacks_is_english_and_one_english_lacks_is_the_key()
    {
        var catalog = Catalog();
        Assert.Equal("Cześć Sam", catalog.Text("pl", "hello", Args(("name", "Sam"))));
        Assert.Equal("Only in English", catalog.Text("pl", "only.english"));
        Assert.Equal("no.such.key", catalog.Text("pl", "no.such.key"));
        Assert.Equal("Hello Sam", catalog.Text("de", "hello", Args(("name", "Sam"))));
    }

    [Theory]
    [InlineData("pl", 1, "1 godzina")]
    [InlineData("pl", 3, "3 godziny")]
    [InlineData("pl", 5, "5 godzin")]
    [InlineData("pl", 22, "22 godziny")]
    [InlineData("ru", 21, "21 час")]
    [InlineData("ru", 11, "11 часов")]
    [InlineData("en", 1, "1 hour")]
    [InlineData("en", 2, "2 hours")]
    // Japanese has no plural forms, but English text keeps English rules.
    [InlineData("ja", 1, "1 hour")]
    public void Plurals_follow_the_language_of_the_text(string language, int count, string expected) =>
        Assert.Equal(expected, Catalog().Text(language, "hours", Args(("count", count))));

    [Fact]
    public void Exact_matches_selects_and_apostrophes_read_as_icu_does()
    {
        var catalog = Catalog();
        Assert.Equal("one hour", catalog.Text("en", "exactly", Args(("count", 1))));
        Assert.Equal("24 hours", catalog.Text("en", "exactly", Args(("count", 24))));
        Assert.Equal("Starts", catalog.Text("en", "kind", Args(("kind", "starts"))));
        Assert.Equal("Due", catalog.Text("en", "kind", Args(("kind", "anything"))));
        Assert.Equal("You're invited to x.example", catalog.Text("en", "invited", Args(("server", "x.example"))));
        Assert.Equal("Sam's list", catalog.Text("en", "owner", Args(("actor", "Sam"))));
    }

    [Fact]
    public void A_missing_parameter_stays_visible_and_nothing_throws()
    {
        var catalog = Catalog();
        Assert.Equal("Hello {name}", catalog.Text("en", "hello"));
        Assert.NotNull(catalog.Text("en", "hours"));
        Assert.NotNull(catalog.Text("en", "broken", Args(("count", 2))));
        Assert.NotNull(catalog.Text("en", "kind"));
    }

    [Fact]
    public void A_value_is_text_and_is_never_read_as_a_message()
    {
        var catalog = Catalog();
        Assert.Equal("Hello {count, plural, other {#}}", catalog.Text("en", "hello", Args(("name", "{count, plural, other {#}}"))));
        Assert.Equal("{evil}'s list", catalog.Text("en", "owner", Args(("actor", "{evil}"))));
    }
}

public sealed class JsonTextCatalogContract : TextCatalogContract
{
    protected override ITextCatalog Make(IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> catalogs) => new JsonTextCatalog(catalogs);
}

/// <summary>The server's own catalog (PL-148): whole, valid, and all of it reachable by translation.</summary>
public sealed partial class ServerCatalogTests
{
    private static IReadOnlyDictionary<string, string> English => JsonTextCatalog.Embedded.EnglishMessages;

    [GeneratedRegex(@"\{\s*(\w+)\s*[,}]")]
    private static partial Regex Parameter();

    private static Dictionary<string, object?> SampleArgs(string message) =>
        Parameter().Matches(message).Select(match => match.Groups[1].Value).Distinct()
            .ToDictionary(name => name, object? (_) => 2, StringComparer.Ordinal);

    [Fact]
    public void The_embedded_catalogs_start_with_english_and_every_message_reads_in_each()
    {
        Assert.Equal("en", JsonTextCatalog.Embedded.Languages[0]);
        Assert.True(English.Count > 30);
        foreach (var language in JsonTextCatalog.Embedded.Languages)
        {
            foreach (var (key, message) in English)
            {
                var text = JsonTextCatalog.Embedded.Text(language, key, SampleArgs(message));
                Assert.False(text.Contains('{') || text.Contains('}') || text.Contains('#'), $"{language} {key}: {text}");
            }
        }
    }

    [Fact]
    public void Every_message_turns_into_the_pseudo_language_with_no_english_left()
    {
        var pseudo = new JsonTextCatalog(new Dictionary<string, IReadOnlyDictionary<string, string>>
        {
            ["en"] = English,
            [PseudoLocale.Tag] = PseudoLocale.Of(English),
        });
        foreach (var (key, message) in English)
        {
            if (key.EndsWith("Pattern", StringComparison.Ordinal)) continue;
            var text = pseudo.Text(PseudoLocale.Tag, key, SampleArgs(message));
            Assert.False(PseudoLocale.HasPlainLetters(text), $"{key}: {text}");
            Assert.StartsWith("[", text);
        }
    }

    [Fact]
    public void The_pseudo_language_keeps_icu_syntax()
    {
        Assert.Equal("[{count, plural, one {# ħöûŕ} other {# ħöûŕš}}]", PseudoLocale.Message("{count, plural, one {# hour} other {# hours}}"));
        Assert.Equal("[Ýöû'ŕé îñṽîŧéđ ŧö {server}]", PseudoLocale.Message("You're invited to {server}"));
        Assert.Equal("[{kind, select, starts {Šŧàŕŧš} other {Đûé}}]", PseudoLocale.Message("{kind, select, starts {Starts} other {Due}}"));
        Assert.Equal("['{'ẋ'}' #]", PseudoLocale.Message("'{'x'}' #"));
    }

    [Fact]
    public void Every_letter_has_its_own_accented_letter()
    {
        const string letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        var accented = PseudoLocale.Message(letters)[1..^1];
        Assert.Equal(letters.Length, accented.Length);
        Assert.False(PseudoLocale.HasPlainLetters(accented));
        Assert.Equal(letters.Length, accented.Distinct().Count());
    }

    [Fact]
    public void Day_and_month_names_come_from_the_catalog()
    {
        var pseudo = new Words(new JsonTextCatalog(new Dictionary<string, IReadOnlyDictionary<string, string>>
        {
            ["en"] = English,
            [PseudoLocale.Tag] = PseudoLocale.Of(English),
        }), PseudoLocale.Tag);
        var thursday = new DateOnly(2026, 11, 26);
        Assert.Equal("Thu, Nov 26", DatePattern.Format(thursday, "ddd, MMM D"));
        Assert.Equal("Thursday 26 November 2026", DatePattern.Format(thursday, "dddd D MMMM YYYY"));
        Assert.Equal("[Ŧħû], [Ñöṽ] 26", DatePattern.Format(thursday, "ddd, MMM D", pseudo));
    }
}

public sealed class AcceptLanguageTests
{
    [Fact]
    public void Tags_come_most_wanted_first_without_wildcards_refusals_or_junk()
    {
        Assert.Equal(["de-DE", "de", "en"], AcceptLanguage.Tags("de-DE,de;q=0.9,en;q=0.8"));
        Assert.Equal(["fr", "en"], AcceptLanguage.Tags("en;q=0.5, fr"));
        Assert.Equal(["pt-BR"], AcceptLanguage.Tags("pt_BR, *;q=0.1, de;q=0, <script>, en-US-very-long-variant-x"));
        Assert.Equal(["en"], AcceptLanguage.Tags("en, EN, en;q=0.4"));
        Assert.Empty(AcceptLanguage.Tags(null));
        Assert.Empty(AcceptLanguage.Tags("   "));
        Assert.Equal(AcceptLanguage.MaxTags, AcceptLanguage.Tags(string.Join(',', Enumerable.Range(0, 20).Select(each => $"x{(char)('a' + each)}"))).Count);
    }

    [Fact]
    public void Joined_tags_stay_short_and_read_back_the_same()
    {
        Assert.Equal("de-DE,de,en", AcceptLanguage.Join(["de-DE", "de", "en"]));
        Assert.Null(AcceptLanguage.Join([]));
        var many = AcceptLanguage.Join(Enumerable.Range(0, 40).Select(each => $"zh-Hant-{each:00}"))!;
        Assert.True(many.Length <= AcceptLanguage.MaxLength);
        Assert.DoesNotContain(",,", many);
        Assert.Equal(["de-DE", "de", "en"], AcceptLanguage.Split("de-DE,de,en"));
    }
}

public sealed class TextLanguageTests
{
    private static readonly JsonTextCatalog Catalog = new(new Dictionary<string, IReadOnlyDictionary<string, string>>
    {
        ["en"] = new Dictionary<string, string> { ["hi"] = "Hi" },
        ["de"] = new Dictionary<string, string> { ["hi"] = "Hallo" },
        ["pl"] = new Dictionary<string, string> { ["hi"] = "Cześć" },
    });

    private static JsonObject Picked(string? language) => new() { ["userId"] = "u1", ["language"] = language };

    [Fact]
    public void A_picked_language_comes_first_then_the_device_then_english()
    {
        Assert.Equal("pl", TextLanguage.For(Catalog, Picked("pl"), ["de"]).Language);
        Assert.Equal("de", TextLanguage.For(Catalog, null, ["de-AT", "pl"]).Language);
        Assert.Equal("de", TextLanguage.For(Catalog, Picked(null), ["de"]).Language);
        Assert.Equal("en", TextLanguage.For(Catalog, null).Language);
        Assert.Equal("Hallo", TextLanguage.For(Catalog, null, ["de"])["hi"]);
    }

    [Fact]
    public void Picking_english_is_a_choice_but_a_language_without_a_catalog_is_automatic()
    {
        Assert.Equal("en", TextLanguage.For(Catalog, Picked("en"), ["de"]).Language);
        Assert.Equal("en", TextLanguage.For(Catalog, Picked("en-GB"), ["de"]).Language);
        Assert.Equal("de", TextLanguage.For(Catalog, Picked("it"), ["de"]).Language);
        Assert.Equal("de", TextLanguage.For(Catalog, Picked("  "), ["de"]).Language);
        Assert.Equal("de", TextLanguage.For(Catalog, new JsonObject { ["language"] = 7 }, ["de"]).Language);
    }
}
