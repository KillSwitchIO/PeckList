using System.Globalization;
using System.Net;
using System.Text;

namespace Punchlist.Collector;

/// <summary>
/// The status page at <c>/api/private/</c>: the same totals as <c>/api/private/v1/stats</c>,
/// for a person in a browser. One self-contained page, no scripts, no outside assets.
/// </summary>
public static class StatusPage
{
    private static readonly (string Key, string Title)[] Dimensions =
    [
        ("version", "Version"),
        ("channel", "Channel"),
        ("database", "Database"),
        ("os", "Operating system"),
        ("arch", "Architecture"),
        ("container", "In a container"),
        ("users", "People per server"),
        ("openTasks", "Open tasks per server"),
        ("localLogin", "Password sign-in"),
        ("oidc", "Identity provider"),
    ];

    public static string Render(PublicStats stats)
    {
        var html = new StringBuilder();
        html.Append("""
            <!doctype html>
            <html lang="en">
            <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta name="robots" content="noindex">
            <title>Punchlist telemetry</title>
            <style>
            :root { color-scheme: light dark; --fg: #1d1f21; --muted: #5f6368; --line: #dadce0; --bg: #ffffff; --bar: #4f8a8b; }
            @media (prefers-color-scheme: dark) { :root { --fg: #e8eaed; --muted: #9aa0a6; --line: #3c4043; --bg: #1d1f21; --bar: #7fb8b9; } }
            body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
            main { max-width: 760px; margin: 0 auto; }
            h1 { font-size: 24px; margin: 0 0 4px; }
            p { color: var(--muted); margin: 0 0 16px; }
            .total { font-size: 40px; font-weight: 600; margin: 16px 0 0; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 24px; }
            section { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
            h2 { font-size: 14px; margin: 0 0 8px; color: var(--muted); font-weight: 600; }
            .row { display: grid; grid-template-columns: 1fr auto; gap: 8px; font-variant-numeric: tabular-nums; }
            .bar { grid-column: 1 / -1; height: 4px; background: var(--bar); border-radius: 2px; margin: 2px 0 8px; }
            .none { color: var(--muted); }
            a { color: inherit; }
            </style>
            </head>
            <body><main>
            <h1>Punchlist telemetry</h1>
            <p>Anonymous counts from Punchlist servers that send the daily usage report. A value fewer than five installs share is not shown.</p>
            """);
        html.Append(CultureInfo.InvariantCulture, $"<div class=\"total\">{stats.Installs:N0}</div>");
        html.Append(CultureInfo.InvariantCulture, $"<p>servers reported in the last {stats.WindowDays} days</p>");
        html.Append("<div class=\"grid\">");
        foreach (var (key, title) in Dimensions)
        {
            html.Append(CultureInfo.InvariantCulture, $"<section><h2>{title}</h2>");
            var values = stats.Breakdown.TryGetValue(key, out var found) ? found : [];
            if (values.Count == 0)
            {
                html.Append("<div class=\"none\">Not enough servers yet</div>");
            }
            else
            {
                var largest = values.Max(value => value.Installs);
                foreach (var value in values)
                {
                    var width = largest == 0 ? 0 : 100 * value.Installs / largest;
                    html.Append(CultureInfo.InvariantCulture,
                        $"<div class=\"row\"><span>{WebUtility.HtmlEncode(Shown(value.Value))}</span><span>{value.Installs:N0}</span><span class=\"bar\" style=\"width:{width}%\"></span></div>");
                }
            }
            html.Append("</section>");
        }
        html.Append("</div>");
        html.Append(CultureInfo.InvariantCulture,
            $"<p style=\"margin-top:24px\">Updated {stats.Generated:yyyy-MM-dd HH:mm} UTC. <a href=\"/api/private/v1/stats\">The same as JSON</a>. ");
        html.Append("What a report holds, and how to turn it off: <a href=\"https://gitlab.com/killswitch10/punchlist/-/blob/main/docs/using/privacy.md\">privacy</a>.</p>");
        html.Append("</main></body></html>");
        return html.ToString();
    }

    // Switches read as words, not JSON.
    private static string Shown(string value) => value switch
    {
        "true" => "Yes",
        "false" => "No",
        _ => value,
    };
}
