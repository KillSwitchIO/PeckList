using System.Diagnostics;
using System.Text;

namespace PeckList.Client;

/// <summary>What the commands talk to: the console, the environment, the token store, the network. Tests swap each.</summary>
public sealed class ClientIo
{
    public required TextWriter Out { get; init; }
    public required TextWriter Err { get; init; }
    public TextReader In { get; init; } = TextReader.Null;
    public Func<string, string?> Environment { get; init; } = System.Environment.GetEnvironmentVariable;

    /// <summary>Null: the file for the person running the CLI.</summary>
    public ITokenStore? Store { get; init; }

    /// <summary>Null: the network, following no redirects.</summary>
    public HttpMessageHandler? Handler { get; init; }

    public Func<string, bool> OpenBrowser { get; init; } = Browser.TryOpen;
    public Func<TimeSpan, CancellationToken, Task> Delay { get; init; } = Task.Delay;
    public bool InputRedirected { get; init; }
    public Func<string?> ReadSecret { get; init; } = ConsoleSecret.Read;
    public Func<Stream>? StandardOutput { get; init; }
    public string HostName { get; init; } = System.Environment.MachineName;
    public Func<DateTimeOffset> Now { get; init; } = () => DateTimeOffset.UtcNow;

    /// <summary>The zone dates are shown in and "today" means (PL-142).</summary>
    public TimeZoneInfo Zone { get; init; } = TimeZoneInfo.Local;

    /// <summary>The terminal's width, or null when the output goes to a file or a pipe (then nothing is cut).</summary>
    public Func<int?> Width { get; init; } = () => null;

    /// <summary>How long shell completion may take before it gives up and prints nothing (PL-138).</summary>
    public TimeSpan CompletionLimit { get; init; } = TimeSpan.FromSeconds(1);

    public static ClientIo FromConsole() => new()
    {
        Out = Console.Out,
        Err = Console.Error,
        In = Console.In,
        InputRedirected = Console.IsInputRedirected,
        StandardOutput = Console.OpenStandardOutput,
        Width = ConsoleWidth,
    };

    private static int? ConsoleWidth()
    {
        if (Console.IsOutputRedirected) return null;
        try
        {
            return Console.WindowWidth is > 20 and var width ? width : null;
        }
        catch (Exception failure) when (failure is IOException or PlatformNotSupportedException or InvalidOperationException)
        {
            return null;
        }
    }
}

/// <summary>A key typed at a prompt, not shown.</summary>
public static class ConsoleSecret
{
    public static string? Read()
    {
        var typed = new StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) break;
            if (key.Key == ConsoleKey.Backspace)
            {
                if (typed.Length > 0) typed.Length--;
                continue;
            }
            if (!char.IsControl(key.KeyChar)) typed.Append(key.KeyChar);
        }
        Console.Error.WriteLine();
        return typed.ToString();
    }
}

/// <summary>Opening the approval page, when there is a desktop to open it on. Never through a shell.</summary>
public static class Browser
{
    public static bool TryOpen(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) return false;
        try
        {
            ProcessStartInfo start;
            if (OperatingSystem.IsWindows())
            {
                start = new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true };
            }
            else if (OperatingSystem.IsMacOS())
            {
                start = new ProcessStartInfo("open") { UseShellExecute = false };
                start.ArgumentList.Add(uri.AbsoluteUri);
            }
            else
            {
                // A server or a container has no desktop: print the address only.
                if (string.IsNullOrEmpty(System.Environment.GetEnvironmentVariable("DISPLAY"))
                    && string.IsNullOrEmpty(System.Environment.GetEnvironmentVariable("WAYLAND_DISPLAY"))) return false;
                start = new ProcessStartInfo("xdg-open") { UseShellExecute = false };
                start.ArgumentList.Add(uri.AbsoluteUri);
            }
            start.RedirectStandardOutput = !start.UseShellExecute;
            start.RedirectStandardError = !start.UseShellExecute;
            using var process = Process.Start(start);
            return process is not null;
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException or PlatformNotSupportedException)
        {
            return false;
        }
    }
}
