namespace PeckList.Server.Auth;

/// <summary>
/// A second layer under <c>SameSite=Lax</c> (audit S11): a request that changes something (any
/// method but GET, HEAD, OPTIONS and TRACE) is refused when a browser says it came from another site.
/// Browsers send <c>Sec-Fetch-Site</c>, and older ones at least <c>Origin</c>; a request with neither
/// is not a browser's (the CLI, a script with an API key), which cookies alone never sent anyway.
/// </summary>
public static partial class SameOriginGuard
{
    /// <summary>Whether the request came from this server's own pages, or from no browser at all.</summary>
    public static bool Allows(HttpContext context)
    {
        var fetchSite = context.Request.Headers["Sec-Fetch-Site"].ToString();
        // "none": the person made the request themselves (typed it, a bookmark), not a page.
        if (fetchSite.Length > 0) return fetchSite is "same-origin" or "none";
        var origin = context.Request.Headers.Origin.ToString();
        if (origin == "null" && IsAppRedeem(context)) return true;
        return origin.Length == 0
            || string.Equals(origin, ServerApp.Origin(context), StringComparison.OrdinalIgnoreCase)
            || string.Equals(origin, $"{context.Request.Scheme}://{context.Request.Host}", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The Android app's last sign-in step (<see cref="AppSignIn"/>, step 3): the shell posts the
    /// one-time code and its verifier with <c>WebView.postUrl</c>, a navigation no page started. To a
    /// server over plain http (a home server, which the app allows) the WebView sends no
    /// <c>Sec-Fetch-Site</c>, since browsers send it only to secure origins, and the Origin of a
    /// navigation without a page is <c>null</c>. The guard refused it, and the app came back from the
    /// browser to a <c>cross_site</c> page (found by the Appium tests, 2026-11-21). Over https the same
    /// request says <c>Sec-Fetch-Site: none</c> and passes above. This path alone takes it, and only
    /// with the <c>X-Requested-With</c> an Android WebView adds (its app's package name, seen on the
    /// wire from WebView 133): a page's form cannot set that header, so another site cannot sign a
    /// browser in to an account of its choosing this way (Security, 2026-11-21). Any package name
    /// is taken, as the hand-off takes forks' own schemes. What it signs in with is still the code and
    /// the verifier, never a cookie the browser sends along.
    /// <para>
    /// Chromium once planned to drop the header from WebView, then cancelled that (androidx.webkit
    /// 1.15.0-alpha03, October 2025: sent on every request again, its allow-list API deprecated), so
    /// the app sets nothing for it. A WebView without it (one frozen in the 2023-2025 trial, or a
    /// hardened one that strips it) fails closed: provider sign-in to a plain-http server is refused,
    /// while password sign-in and https keep working. It stays required, since an optional header
    /// protects nothing (Security, 2026-11-21). The native redeem (PL-070 follow-up) posts the code
    /// from the shell itself, and its done-definition is deleting this exception.
    /// </para>
    /// </summary>
    private static bool IsAppRedeem(HttpContext context) =>
        HttpMethods.IsPost(context.Request.Method)
        && context.Request.Path.Equals("/auth/app/redeem", StringComparison.OrdinalIgnoreCase)
        && AppPackage().IsMatch(context.Request.Headers["X-Requested-With"].ToString());

    /// <summary>An Android package name: two or more dot-separated parts, each starting with a letter.</summary>
    [System.Text.RegularExpressions.GeneratedRegex(@"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$")]
    private static partial System.Text.RegularExpressions.Regex AppPackage();

    private static bool Changes(string method) =>
        !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method) || HttpMethods.IsTrace(method));

    /// <summary>
    /// Refuse a cross-site request that changes something, with 403 <c>cross_site</c>. The app's
    /// redeem is a navigation, so a refused one goes to the sign-in page with a reason a person can
    /// read (a WebView without <c>X-Requested-With</c> on a plain-http server), not a page of JSON.
    /// </summary>
    public static void UseSameOriginGuard(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        if (!Changes(context.Request.Method) || Allows(context))
        {
            await next(context);
            return;
        }
        if (context.Request.Path.Equals("/auth/app/redeem", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status303SeeOther;
            context.Response.Headers.Location = "/login?error=app_sign_in_refused";
            return;
        }
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new AuthError("cross_site"), context.RequestAborted);
    });
}
