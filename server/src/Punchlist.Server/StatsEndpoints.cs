using Punchlist.Core.Accounts;
using Punchlist.Core.Stats;
using Punchlist.Server.Auth;

namespace Punchlist.Server;

/// <summary><c>/api/admin/stats</c>: server totals and a row per person (spec: Server stats). Counts only.</summary>
public static class StatsEndpoints
{
    public static RouteGroupBuilder MapStats(this RouteGroupBuilder admin)
    {
        admin.MapGet("/stats", async (StatsService stats, CancellationToken cancellation) => await stats.GetAsync(cancellation))
            .RequirePermission(Permission.ViewStats);
        return admin;
    }
}
