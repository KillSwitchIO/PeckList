using PeckList.Client;

// The client download: every command talks to a server over HTTP (PL-133).
return await ClientCli.RunAsync(args, ClientIo.FromConsole(), serverBuild: false);
