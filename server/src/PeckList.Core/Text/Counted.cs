namespace PeckList.Core.Text;

/// <summary>
/// A count with its noun, singular for one ("1 account", "2 accounts"), for the English-only
/// command line, logs and audit details. What people read in the apps goes through the catalogs.
/// </summary>
public static class Counted
{
    public static string Of(long count, string one, string other) => $"{count} {(count == 1 ? one : other)}";

    public static string Accounts(long count) => Of(count, "account", "accounts");

    public static string Entities(long count) => Of(count, "entity", "entities");
}
