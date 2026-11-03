using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Sharing;

namespace PeckList.Server.Tests;

/// <summary>Friends first: people share with, assign and invite only people they know (audit S3).</summary>
internal static class Befriending
{
    public static async Task BefriendAsync(this WebApplicationFactory<Program> server, string a, string b) =>
        Assert.NotNull(await server.Services.GetRequiredService<Friends>()
            .MakeFriendsAsync(a, b, cancellation: TestContext.Current.CancellationToken));
}
