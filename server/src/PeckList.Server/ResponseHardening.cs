using System.IO.Compression;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.Net.Http.Headers;

namespace PeckList.Server;

/// <summary>
/// Browser security headers, HSTS and compression the server sends itself, so a plain reverse
/// proxy is enough and a server reached without one is protected too (docs: guides/security.md).
/// </summary>
public static class ResponseHardening
{
    /// <summary>
    /// What the web app needs and no more: its own scripts only (the schema validator is compiled at
    /// build time, so no 'unsafe-eval'); inline styles, which its components set; images from
    /// itself, <c>data:</c> and <c>blob:</c> (attachments and photos read from the device). Nothing
    /// may frame it.
    /// </summary>
    public const string ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "connect-src 'self'; font-src 'self' data:; worker-src 'self'; manifest-src 'self'; " +
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

    public static IServiceCollection AddResponseHardening(this IServiceCollection services)
    {
        // Browsers that have been here over https keep to https for a year. Sent only on https
        // requests (through a trusted proxy: X-Forwarded-Proto) and never for localhost.
        services.AddHsts(options => options.MaxAge = TimeSpan.FromDays(365));
        services.AddResponseCompression(options =>
        {
            // Behind a proxy that ends TLS every request counts as https. Compressing over https
            // only matters (BREACH) for a secret sent next to text an attacker chooses, many times
            // over; sessions are cookies, which this does not touch.
            options.EnableForHttps = true;
            options.Providers.Add<BrotliCompressionProvider>();
            options.Providers.Add<GzipCompressionProvider>();
            // The defaults plus the web build's own types. Never text/event-stream: live updates
            // must reach the app the moment they are written.
            options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(
                ["text/javascript", "image/svg+xml", "application/manifest+json"]);
        });
        // The answers are built per request. Brotli at its fastest packed a sync page of 954 KB into
        // 201 KB, worse than gzip's fastest (113 KB), and browsers ask for Brotli first; its default
        // level (Optimal, quality 4) costs a few milliseconds more and packs smaller than gzip.
        services.Configure<BrotliCompressionProviderOptions>(options => options.Level = CompressionLevel.Optimal);
        services.Configure<GzipCompressionProviderOptions>(options => options.Level = CompressionLevel.Fastest);
        return services;
    }

    /// <summary>After <c>UseForwardedHeaders</c>, so https is known from the proxy.</summary>
    public static void UseResponseHardening(this WebApplication app)
    {
        app.UseHsts();
        app.Use((context, next) =>
        {
            context.Response.OnStarting(() =>
            {
                // A response's own headers win: attachments and provider icons send a stricter,
                // sandboxed policy of their own.
                var headers = context.Response.Headers;
                headers.TryAdd(HeaderNames.XContentTypeOptions, "nosniff");
                headers.TryAdd(HeaderNames.XFrameOptions, "DENY");
                headers.TryAdd("Referrer-Policy", "same-origin");
                headers.TryAdd(HeaderNames.ContentSecurityPolicy, ContentSecurityPolicy);
                return Task.CompletedTask;
            });
            return next(context);
        });
        app.UseResponseCompression();
    }
}
