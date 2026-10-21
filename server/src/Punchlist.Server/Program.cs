using Punchlist.Core.Configuration;
using Punchlist.Server;

// `healthcheck`: the image has no shell or curl, so Docker's health check runs the server binary.
if (args is ["healthcheck", ..])
{
    return await HealthCheckCommand.RunAsync(Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS"));
}

if (args.Length > 0 && Cli.Commands.Contains(args[0]))
{
    return await Cli.RunAsync(args, Console.Out, Console.Error, Console.OpenStandardOutput());
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
app.Run();
return 0;

/// <summary>Entry point, public so integration tests can host the app.</summary>
public partial class Program;
