namespace PeckList.Server.Auth;

/// <summary>
/// A second layer under <c>SameSite=Lax</c> (audit S11): a request that changes something (any
/// method but GET, HEAD, OPTIONS and TRACE) is refused when a browser says it came from another site.
/// Browsers send <c>Sec-Fetch-Site</c>, and older ones at least <c>Origin</c>; a request with neither
/// is not a browser's (the CLI, a script with an API key), which cookies alone never sent anyway.
/// </summary>
public static class SameOriginGuard
{
    /// <summary>Whether the request came from this server's own pages, or from no browser at all.</summary>
    public static bool Allows(HttpContext context)
    {
        var fetchSite = context.Request.Headers["Sec-Fetch-Site"].ToString();
        // "none": the person made the request themselves (typed it, a bookmark), not a page.
        if (fetchSite.Length > 0) return fetchSite is "same-origin" or "none";
        var origin = context.Request.Headers.Origin.ToString();
        return origin.Length == 0
            || string.Equals(origin, ServerApp.Origin(context), StringComparison.OrdinalIgnoreCase)
            || string.Equals(origin, $"{context.Request.Scheme}://{context.Request.Host}", StringComparison.OrdinalIgnoreCase);
    }

    private static bool Changes(string method) =>
        !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method) || HttpMethods.IsTrace(method));

    /// <summary>Refuse a cross-site request that changes something, with 403 <c>cross_site</c>.</summary>
    public static void UseSameOriginGuard(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        if (!Changes(context.Request.Method) || Allows(context))
        {
            await next(context);
            return;
        }
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new AuthError("cross_site"), context.RequestAborted);
    });
}
