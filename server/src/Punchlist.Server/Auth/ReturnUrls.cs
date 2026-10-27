namespace Punchlist.Server.Auth;

/// <summary>Where a sign-in sends people afterwards.</summary>
public static class ReturnUrls
{
    /// <summary>Only back into this app: a path, never another site (<c>//evil</c> and <c>/\evil</c> included).</summary>
    public static string Safe(string? returnUrl) =>
        returnUrl is { Length: > 0 } && returnUrl.StartsWith('/') && !returnUrl.StartsWith("//", StringComparison.Ordinal)
            && !returnUrl.StartsWith("/\\", StringComparison.Ordinal)
            ? returnUrl
            : "/";
}
