using System.Text;
using PeckList.CalDav.ICalendar;

namespace PeckList.CalDav.Tests;

public sealed class CalTextTests
{
    private static string Lines(params string[] lines) => string.Join("\r\n", lines) + "\r\n";

    [Fact]
    public void Unfolds_lines_continued_with_a_space_or_a_tab()
    {
        var root = CalText.Parse("BEGIN:VCALENDAR\nBEGIN:VEVENT\r\nSUMMARY:Lunch with\r\n  the team\n\tand friends\r\nEND:VEVENT\r\nEND:VCALENDAR");

        Assert.Equal("Lunch with the teamand friends", root.Children[0].Property("SUMMARY")!.Value);
    }

    [Fact]
    public void Reads_quoted_parameters_that_hold_colons_and_semicolons()
    {
        var root = CalText.Parse(Lines("BEGIN:VCALENDAR", "BEGIN:VEVENT",
            "ATTENDEE;CN=\"Doe; Jane\";DELEGATED-TO=\"mailto:a@example.com\",\"mailto:b@example.com\":mailto:jane@example.com",
            "END:VEVENT", "END:VCALENDAR"));

        var attendee = root.Children[0].Property("ATTENDEE")!;
        Assert.Equal("Doe; Jane", attendee.Param("cn"));
        Assert.Equal(["mailto:a@example.com", "mailto:b@example.com"], attendee.Parameters[1].Values);
        Assert.Equal("mailto:jane@example.com", attendee.Value);
    }

    [Fact]
    public void Writes_untouched_properties_back_exactly_as_they_were()
    {
        var text = Lines("BEGIN:VCALENDAR", "BEGIN:VEVENT",
            "ATTENDEE;CN=\"Doe; Jane\";DELEGATED-TO=\"mailto:a@example.com\",\"mailto:b@example.com\":mailto:jane@example.com",
            "X-APPLE-TRAVEL-ADVISORY-BEHAVIOR;x-custom=1:AUTOMATIC", "END:VEVENT", "END:VCALENDAR");

        var written = CalText.Write(CalText.Parse(text));

        Assert.Equal(Unfold(text), Unfold(written));
    }

    [Theory]
    [InlineData("Plain")]
    [InlineData("Commas, semicolons; and a \\ backslash")]
    [InlineData("Two\nlines\r\nand a third")]
    public void Escapes_text_so_it_reads_back_the_same(string text)
    {
        Assert.Equal(text.Replace("\r\n", "\n"), CalText.Unescape(CalText.Escape(text)));
    }

    [Fact]
    public void Folds_long_lines_at_75_octets_without_splitting_a_character()
    {
        var root = new CalComponent("VCALENDAR");
        var summary = string.Concat(Enumerable.Repeat("Größe 🐦 ", 30));
        root.Properties.Add(new CalProperty("SUMMARY", CalText.Escape(summary)));

        var written = CalText.Write(root);

        foreach (var line in written.Split("\r\n")) Assert.True(Encoding.UTF8.GetByteCount(line) <= 75, line);
        Assert.DoesNotContain('�', written);
        Assert.Equal(summary, CalText.Unescape(CalText.Parse(written).Property("SUMMARY")!.Value));
    }

    [Fact]
    public void Refuses_to_write_a_value_with_a_line_break_in_it()
    {
        var root = new CalComponent("VCALENDAR");
        root.Properties.Add(new CalProperty("SUMMARY", "x\r\nATTENDEE:mailto:someone@example.com"));

        Assert.Throws<ArgumentException>(() => CalText.Write(root));
    }

    [Theory]
    [InlineData("BEGIN:VEVENT\r\nEND:VEVENT\r\n")]
    [InlineData("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VCALENDAR\r\n")]
    [InlineData("BEGIN:VCALENDAR\r\nSUMMARY\r\nEND:VCALENDAR\r\n")]
    [InlineData("BEGIN:VCALENDAR\r\n")]
    [InlineData("<html>not a calendar</html>")]
    public void Refuses_text_that_is_not_a_calendar_object(string text)
    {
        Assert.Throws<CalendarFormatException>(() => CalText.Parse(text));
    }

    [Fact]
    public void Refuses_a_calendar_object_past_the_size_cap()
    {
        var text = "BEGIN:VCALENDAR\r\nX-PAD:" + new string('a', CalText.MaxLength) + "\r\nEND:VCALENDAR\r\n";

        Assert.Throws<CalendarFormatException>(() => CalText.Parse(text));
    }

    [Fact]
    public void Refuses_a_line_with_too_many_parameters()
    {
        var many = new StringBuilder("X-A");
        while (many.Length < CalText.MaxLength - 100) many.Append(";P=a");
        var text = Lines("BEGIN:VCALENDAR", many.Append(":v").ToString(), "END:VCALENDAR");

        Assert.Throws<CalendarFormatException>(() => CalText.Parse(text));
    }

    [Fact]
    public void Refuses_a_carriage_return_inside_a_line()
    {
        Assert.Throws<CalendarFormatException>(() => CalText.Parse("BEGIN:VCALENDAR\r\nSUMMARY:a\rX-B:c\r\nEND:VCALENDAR\r\n"));
    }

    private static string Unfold(string text) => text.Replace("\r\n ", "", StringComparison.Ordinal);
}
