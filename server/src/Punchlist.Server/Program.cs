using Punchlist.Server;

// `healthcheck`: the image has no shell or curl, so Docker's health check runs the server binary.
if (args is ["healthcheck", ..])
{
    return await HealthCheckCommand.RunAsync(Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS"));
}

var app = ServerApp.Build(args);
app.Run();
return 0;

/// <summary>Entry point, public so integration tests can host the app.</summary>
public partial class Program;
