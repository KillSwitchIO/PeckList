using Microsoft.Extensions.Hosting.WindowsServices;
using PeckList.Core.Configuration;
using PeckList.Server;

// `healthcheck`: the image has no shell or curl, so Docker's health check runs the server binary.
if (args is ["healthcheck", ..])
{
    return await HealthCheckCommand.RunAsync(Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS"));
}

if (args is ["--version" or "version", ..])
{
    Console.WriteLine($"pecklist {ServerApp.FullVersion}");
    return 0;
}

if (args.Length > 0 && Cli.Commands.Contains(args[0]))
{
    return await Cli.RunAsync(args, Console.Out, Console.Error, Console.OpenStandardOutput());
}

// A Windows service starts in C:\Windows\System32; relative paths (the default ./data, a relative
// CONFIG_FILE) mean the folder the server is installed in.
if (WindowsServiceHelpers.IsWindowsService())
{
    Directory.SetCurrentDirectory(AppContext.BaseDirectory);
}

WebApplication app;
try
{
    app = ServerApp.Build(args);
}
catch (Exception error) when (error is SettingsException or FormatException)
{
    // A readable list of what to fix, not a stack trace.
    await Console.Error.WriteLineAsync(error.Message);
    return 2;
}
try
{
    app.Run();
}
catch (SettingsException error)
{
    await Console.Error.WriteLineAsync(error.Message);
    return 2;
}
return 0;

/// <summary>Entry point, public so integration tests can host the app.</summary>
public partial class Program;
