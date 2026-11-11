using PeckList.Client;

namespace PeckList.Client.Tests;

/// <summary>Server text reaches the terminal as text only: no escape sequences, no bidi tricks.</summary>
public sealed class PrintableTests
{
    [Theory]
    [InlineData("\u001b]0;pwned\u0007Title", "?]0;pwned?Title")]
    [InlineData("\u001b[2JClear", "?[2JClear")]
    [InlineData("\u001b]52;c;aGk=\u0007", "?]52;c;aGk=?")]
    [InlineData("C1 \u009b31m red", "C1 ?31m red")]
    [InlineData("del\u007f", "del?")]
    [InlineData("evil‮gnp.exe", "evil?gnp.exe")]
    [InlineData("iso⁦late⁩", "iso?late?")]
    [InlineData("two\nlines\r\n", "two lines  ")]
    [InlineData("tab\tkept, ünïcödé and emoji 🐦 kept", "tab\tkept, ünïcödé and emoji 🐦 kept")]
    public void Turns_control_characters_into_plain_text(string text, string printed) =>
        Assert.Equal(printed, ClientCli.Printable(text));

    [Fact]
    public void Notes_keep_their_line_breaks_but_nothing_else() =>
        Assert.Equal("one\ntwo?[2J", ClientCli.Printable("one\ntwo\u001b[2J", keepLineBreaks: true));
}
