using Microsoft.AspNetCore.Identity;
using Punchlist.Core.Accounts;

namespace Punchlist.Server;

/// <summary>Passwords through ASP.NET Core Identity's hasher (PBKDF2, upgraded as it moves on).</summary>
public sealed class AspNetPasswordHasher : IPasswordHasher
{
    private static readonly object User = new();
    private readonly PasswordHasher<object> hasher = new();

    public string Hash(string password) => hasher.HashPassword(User, password);

    public bool Verify(string hash, string password, out bool rehash)
    {
        var result = hasher.VerifyHashedPassword(User, hash, password);
        rehash = result == PasswordVerificationResult.SuccessRehashNeeded;
        return result != PasswordVerificationResult.Failed;
    }
}
