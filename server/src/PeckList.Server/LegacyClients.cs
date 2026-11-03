using Microsoft.AspNetCore.Http;

namespace PeckList.Server;

/// <summary>
/// Apps from before the rename (Punchlist 0.5.0 and older) take a server only when <c>/api/info</c>
/// says <c>"punchlist"</c>: the Android app's server check and its bundled web code both compare the
/// name exactly. Answering them with the old name keeps them working against this server until people
/// move to the PeckList app; current apps accept either name, so they need no special case.
/// An old app is one that sends an old <c>X-Punchlist-*</c> header, or asks from Android (the app's
/// own connection, or its WebView) without any <c>X-PeckList-*</c> header. Browsers get the new name.
/// </summary>
public static class LegacyClients
{
    public const string OldName = "punchlist";

    public static bool WantsOldName(HttpRequest request)
    {
        var sendsNew = false;
        foreach (var key in request.Headers.Keys)
        {
            if (key.StartsWith("X-PeckList-", StringComparison.OrdinalIgnoreCase)) sendsNew = true;
            else if (key.StartsWith("X-Punchlist-", StringComparison.OrdinalIgnoreCase)) return true;
        }
        if (sendsNew) return false;
        var agent = request.Headers.UserAgent.ToString();
        return agent.StartsWith("Dalvik/", StringComparison.Ordinal) || agent.Contains("; wv)", StringComparison.Ordinal);
    }
}
