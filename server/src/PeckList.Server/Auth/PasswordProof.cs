namespace PeckList.Server.Auth;

/// <summary>
/// The password a signed-in person gives to confirm something: deleting their account, changing or
/// removing their password. Wrong ones count toward the sign-in lockout
/// (<see cref="Core.Accounts.AccountService.ConfirmPasswordAsync"/>), and these answers match
/// sign-in's: ten tries a minute per account name, and a locked account told when the lock ends.
/// </summary>
public static class PasswordProof
{
    /// <summary>
    /// Null when another try may go ahead; else 429 with Retry-After. The tries come out of the
    /// same per-name bucket as sign-in (audit S6), so a session held from several addresses cannot
    /// fit more guesses into a lock window than sign-in allows.
    /// </summary>
    public static IResult? TooMany(LoginAttempts attempts, string? username, HttpContext context)
    {
        if (attempts.TryTake(username, out var wait)) return null;
        AuthSetup.RetryAfter(context.Response, wait);
        return Results.StatusCode(StatusCodes.Status429TooManyRequests);
    }

    /// <summary>423 for a locked account: when the lock ends, in the body and in Retry-After.</summary>
    public static IResult Locked(HttpContext context, DateTimeOffset? until, TimeProvider time)
    {
        if (until is { } end) AuthSetup.RetryAfter(context.Response, end - time.GetUtcNow());
        return Results.Json(new AuthError("locked", until), statusCode: StatusCodes.Status423Locked);
    }
}
