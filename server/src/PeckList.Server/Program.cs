using Microsoft.Extensions.Hosting.WindowsServices;
using PeckList.Core.Configuration;
using PeckList.Server;
using PeckList.Storage.Sql;

// `healthcheck`: the image has no shell or curl, so Docker's health check runs the server binary.
if (args is ["healthcheck", ..])
{
    return await HealthCheckCommand.RunAsync(Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS"));
}

if (args is ["--version" or "-v" or "version", ..])
{
    Console.WriteLine($"pecklist {ServerApp.FullVersion}");
    return 0;
}

// The client commands (PL-133), and any command aimed at a server elsewhere (--server, --profile).
if (PeckList.Client.ClientCli.Handles(args))
{
    return await PeckList.Client.ClientCli.RunAsync(args, PeckList.Client.ClientIo.FromConsole(), serverBuild: true);
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
    return StartupChecks.ExitCodes.Settings;
}
catch (UnauthorizedAccessException error)
{
    await Console.Error.WriteLineAsync(StartupChecks.UnwritableText(error));
    return StartupChecks.ExitCodes.Unwritable;
}
// Anything else: what happened, and exit code 1, not the runtime's crash code and a dump.
catch (Exception error)
{
    await Console.Error.WriteLineAsync(error.ToString());
    return StartupChecks.ExitCodes.Failed;
}
// A data folder owned by someone else (the commonest first-start mistake): one line, not a crash loop.
if (StartupChecks.UnwritableFolder(app.Services.GetRequiredService<ServerSettings>()) is { } unwritable)
{
    await Console.Error.WriteLineAsync(unwritable);
    return StartupChecks.ExitCodes.Unwritable;
}
// A database a newer version upgraded: one line, before anything starts on it.
if (await StartupChecks.NewerDatabaseAsync(app.Services) is { } newer)
{
    await Console.Error.WriteLineAsync(newer);
    return StartupChecks.ExitCodes.NewerDatabase;
}
try
{
    app.Run();
}
catch (SettingsException error)
{
    await Console.Error.WriteLineAsync(error.Message);
    return StartupChecks.ExitCodes.Settings;
}
catch (Exception error) when (StartupChecks.Find<UnauthorizedAccessException>(error) is { } refused)
{
    await Console.Error.WriteLineAsync(StartupChecks.UnwritableText(refused));
    return StartupChecks.ExitCodes.Unwritable;
}
// The check above found nothing in time (a slow database), and migrating met the newer schema:
// the same line, not an unhandled exception and a crash dump (QA, upgrade pass).
catch (Exception error) when (StartupChecks.Find<NewerDatabaseException>(error) is { } newerFound)
{
    await Console.Error.WriteLineAsync(newerFound.Message);
    return StartupChecks.ExitCodes.NewerDatabase;
}
catch (Exception error)
{
    await Console.Error.WriteLineAsync(error.ToString());
    return StartupChecks.ExitCodes.Failed;
}
return 0;

/// <summary>Entry point, public so integration tests can host the app.</summary>
public partial class Program;
