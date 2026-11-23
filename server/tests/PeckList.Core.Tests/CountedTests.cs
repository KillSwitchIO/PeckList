using PeckList.Core.Text;

namespace PeckList.Core.Tests;

public class CountedTests
{
    [Theory]
    [InlineData(0, "0 accounts")]
    [InlineData(1, "1 account")]
    [InlineData(2, "2 accounts")]
    public void Says_one_account_and_many_accounts(long count, string expected) =>
        Assert.Equal(expected, Counted.Accounts(count));

    [Fact]
    public void Has_the_entity_plural() =>
        Assert.Equal("1 entity, 7 entities", $"{Counted.Entities(1)}, {Counted.Entities(7)}");
}
