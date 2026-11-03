using System.Net;
using PeckList.Core.Configuration;

namespace PeckList.Server;

/// <summary>
/// Optional visit counts with Umami (<c>UMAMI_*</c>): the served page gets Umami's tracker (and its
/// session recorder with <c>UMAMI_RECORDER</c>), and the security policy lets the page load them from
/// the Umami server and report there. Nothing changes without the settings.
/// </summary>
public static class Analytics
{
    public static string WithUmami(string html, UmamiSettings umami)
    {
        var url = WebUtility.HtmlEncode(umami.Url.ToString().TrimEnd('/'));
        var id = WebUtility.HtmlEncode(umami.WebsiteId);
        var tags = $"<script defer src=\"{url}/script.js\" data-website-id=\"{id}\"></script>";
        if (umami.Recorder) tags += $"<script defer src=\"{url}/recorder.js\" data-website-id=\"{id}\"></script>";
        // At the end of the head; a page without one (as in tests) gets them after its doctype.
        var head = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
        if (head >= 0) return html.Insert(head, tags);
        var doctype = html.IndexOf('>', StringComparison.Ordinal);
        return html.StartsWith("<!doctype", StringComparison.OrdinalIgnoreCase) && doctype > 0 ? html.Insert(doctype + 1, tags) : tags + html;
    }

    /// <summary>
    /// The server's policy (<see cref="ResponseHardening.ContentSecurityPolicy"/>), opened only as far
    /// as Umami needs: its scripts, its report endpoints, and for the recorder a worker it starts
    /// from a <c>blob:</c> address.
    /// </summary>
    public static string ContentSecurityPolicy(UmamiSettings? umami)
    {
        var policy = ResponseHardening.ContentSecurityPolicy;
        if (umami is null) return policy;
        policy = policy
            .Replace("script-src 'self';", $"script-src 'self' {umami.Origin};", StringComparison.Ordinal)
            .Replace("connect-src 'self';", $"connect-src 'self' {umami.Origin};", StringComparison.Ordinal);
        return umami.Recorder ? policy.Replace("worker-src 'self';", "worker-src 'self' blob:;", StringComparison.Ordinal) : policy;
    }
}
