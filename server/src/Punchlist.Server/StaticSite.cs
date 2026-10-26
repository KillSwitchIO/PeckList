using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Net.Http.Headers;

namespace Punchlist.Server;

/// <summary>
/// Serves the PWA build: hashed files under <c>/assets</c> cache for a year, everything else
/// (index.html, the service worker, the manifest) revalidates so an update shows up on the next
/// load. Unknown paths outside the API fall back to index.html for the client-side router.
/// The build writes a <c>.br</c> and <c>.gz</c> of each compressible file (web/precompress.ts);
/// browsers that take one get it as it is, compressed once at the highest setting.
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
        app.Use(async (context, next) =>
        {
            var asked = context.Request.Path;
            ServePrecompressed(context, files);
            await next(context);
            // The access log records what was asked for, not the file that answered it.
            context.Request.Path = asked;
        });
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = files,
            // A precompressed copy has the type of the file it is a copy of.
            ContentTypeProvider = new PrecompressedTypes(),
            OnPrepareResponse = context =>
            {
                SetCaching(context.Context);
                if (context.Context.Items[EncodingKey] is string encoding)
                {
                    context.Context.Response.Headers.ContentEncoding = encoding;
                }
            },
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

    private const string EncodingKey = "punchlist.precompressed";

    /// <summary>Brotli first, then gzip, as the browser allows (q=0 refuses one).</summary>
    private static readonly (string Encoding, string Suffix)[] Encodings = [("br", ".br"), ("gzip", ".gz")];

    /// <summary>
    /// Points the request at the file's <c>.br</c> or <c>.gz</c> when there is one and the browser
    /// takes it; StaticFiles then serves that file and the response says how it is encoded.
    /// </summary>
    private static void ServePrecompressed(HttpContext context, IFileProvider files)
    {
        var path = context.Request.Path.Value;
        if (path is null || !HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method)) return;
        // Whatever the browser takes, the answer depends on what it said it takes.
        if (files.GetFileInfo(path + ".gz").Exists) context.Response.Headers.Append(HeaderNames.Vary, HeaderNames.AcceptEncoding);
        var accepted = context.Request.GetTypedHeaders().AcceptEncoding;
        foreach (var (encoding, suffix) in Encodings)
        {
            var wanted = accepted.Any(value => value.Value.Equals(encoding, StringComparison.OrdinalIgnoreCase) && (value.Quality ?? 1) > 0);
            if (!wanted || !files.GetFileInfo(path + suffix).Exists) continue;
            context.Request.Path = path + suffix;
            context.Items[EncodingKey] = encoding;
            return;
        }
    }

    private sealed class PrecompressedTypes : IContentTypeProvider
    {
        private readonly FileExtensionContentTypeProvider types = new();

        public bool TryGetContentType(string subpath, out string contentType) =>
            types.TryGetContentType(
                subpath.EndsWith(".br", StringComparison.Ordinal) || subpath.EndsWith(".gz", StringComparison.Ordinal) ? subpath[..^3] : subpath,
                out contentType!);
    }

    private static void SetCaching(HttpContext context)
    {
        var immutable = context.Request.Path.StartsWithSegments("/assets", StringComparison.Ordinal);
        context.Response.Headers[HeaderNames.CacheControl] = immutable
            ? "public, max-age=31536000, immutable"
            : "no-cache";
    }
}
