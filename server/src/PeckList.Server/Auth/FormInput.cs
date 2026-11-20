namespace PeckList.Server.Auth;

/// <summary>Reading a posted form on the sign-in pages that take one.</summary>
public static class FormInput
{
    /// <summary>
    /// The form, or null when it cannot be read: the form reader throws on a NUL in a value, and on
    /// a body that is not a form (JSON, or none), each a 500 unhandled (security C2, 2026-11-06). The
    /// caller answers 400.
    /// </summary>
    public static async Task<IFormCollection?> TryReadFormAsync(this HttpRequest request, CancellationToken cancellation)
    {
        if (!request.HasFormContentType) return null;
        try
        {
            return await request.ReadFormAsync(cancellation);
        }
        catch (InvalidDataException)
        {
            return null;
        }
    }
}
