using Microsoft.Extensions.FileProviders;
using Microsoft.Net.Http.Headers;

namespace Punchlist.Server;

/// <summary>
/// Serves the PWA build: hashed files under <c>/assets</c> cache for a year, everything else
/// (index.html, the service worker, the manifest) revalidates so an update shows up on the next
/// load. Unknown paths outside the API fall back to index.html for the client-side router.
/// </summary>
public static class StaticSite
{
    /// <summary>
    /// Paths the PWA's router never owns: they 404 instead of falling back to index.html. That
    /// includes missing files (a stale hashed asset must not come back as HTML).
    /// </summary>
    private static readonly string[] ServerPrefixes = ["/api", "/auth", "/healthz", "/assets"];

    public static void UseStaticSite(this WebApplication app, string webRoot, ILogger logger)
    {
        if (!File.Exists(Path.Combine(webRoot, "index.html")))
        {
            logger.LogWarning("No web build at {WebRoot}: serving the API only", webRoot);
            return;
        }
        var files = new PhysicalFileProvider(Path.GetFullPath(webRoot));
        app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = files,
            OnPrepareResponse = context => SetCaching(context.Context),
        });
        app.MapFallback(async context =>
        {
            var path = context.Request.Path.Value ?? "/";
            if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method)
                || ServerPrefixes.Any(prefix => path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                || Path.HasExtension(path))
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }
            context.Response.ContentType = "text/html; charset=utf-8";
            SetCaching(context);
            await context.Response.SendFileAsync(files.GetFileInfo("index.html"));
        });
    }

    private static void SetCaching(HttpContext context)
    {
        var immutable = context.Request.Path.StartsWithSegments("/assets", StringComparison.Ordinal);
        context.Response.Headers[HeaderNames.CacheControl] = immutable
            ? "public, max-age=31536000, immutable"
            : "no-cache";
    }
}
