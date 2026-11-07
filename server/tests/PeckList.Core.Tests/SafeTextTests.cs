namespace PeckList.Core.Tests;

public sealed class SafeTextTests
{
    private const string Bird = "\U0001F426";

    [Theory]
    [InlineData("abc", 5, "abc")]
    [InlineData("abcde", 5, "abcde")]
    [InlineData("abcdef", 5, "abcde")]
    public void A_cut_keeps_at_most_the_length(string text, int length, string expected) =>
        Assert.Equal(expected, SafeText.Cut(text, length));

    [Fact]
    public void A_cut_keeps_a_whole_pair_or_none_of_it()
    {
        Assert.Equal("ab", SafeText.Cut("ab" + Bird + "c", 3));
        Assert.Equal("ab" + Bird, SafeText.Cut("ab" + Bird + "c", 4));
    }

    // A plain test, because an attribute's string cannot hold half a pair: the compiler changes it.
    [Fact]
    public void Cleaning_leaves_only_what_can_be_stored()
    {
        Assert.Equal("plain", SafeText.Clean("plain"));
        Assert.Equal("sam", SafeText.Clean("sa\0m"));
        Assert.Equal("", SafeText.Clean("\0"));
        Assert.Equal("ab", SafeText.Clean("ab\uD83D"));
        Assert.Equal("ab", SafeText.Clean("\uDC26ab"));
        Assert.Equal("ab", SafeText.Clean("a\uD83Db"));
        Assert.Equal(Bird, SafeText.Clean("\uD83D" + Bird));
        Assert.Equal("a" + Bird + "b", SafeText.Clean("a" + Bird + "\0b"));
    }

    [Fact]
    public void Clean_text_comes_back_as_it_was()
    {
        var text = "ab" + Bird;
        Assert.Same(text, SafeText.Clean(text));
        Assert.Null(SafeText.Clean(null));
    }
}
