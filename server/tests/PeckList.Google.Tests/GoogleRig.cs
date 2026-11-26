using PeckList.Calendars.Testing;
using PeckList.Core.Calendars;

namespace PeckList.Google.Tests;

/// <summary>The Google adapter pointed at the fake, with one client and one account. Made-up data only.</summary>
internal sealed class GoogleRig
{
    public const string ClientId = "client-1.apps.googleusercontent.test";
    public const string ClientSecret = "fake-client-secret";

    public FakeGoogle Google { get; } = new();

    public Clients Known { get; } = new();

    public GoogleCalendarProvider Provider { get; }

    public string Address { get; } = $"sam{Guid.NewGuid():N}@example.com";

    public string RefreshToken { get; }

    /// <summary>The secrets the adapter handed back through <see cref="CalendarConnection.SecretChanged"/>.</summary>
    public List<string> Saved { get; } = [];

    public GoogleRig(string scope = FakeGoogle.AllScopes)
    {
        Google.AddClient(ClientId, ClientSecret);
        Known.Add(new GoogleClient(ClientId, ClientSecret, Relay: false));
        Provider = new GoogleCalendarProvider(new HttpClient(Google), Known, TimeProvider.System,
            new GoogleAddresses(FakeGoogle.Api, FakeGoogle.TokenUrl, FakeGoogle.RevokeUrl, FakeGoogle.AuthorizeUrl));
        RefreshToken = Google.AddAccount(Address, ClientId, scope);
    }

    /// <summary>A connection with only a refresh token, as after a restart: the first call refreshes.</summary>
    public CalendarConnection Connection(string? refreshToken = null, string clientId = ClientId) =>
        new(GoogleCalendarProvider.ServerUrl, null,
            new GoogleToken(refreshToken ?? RefreshToken, null, DateTimeOffset.UnixEpoch, clientId, FakeGoogle.AllScopes).Write(),
            secret =>
            {
                lock (Saved) Saved.Add(secret);
                return Task.CompletedTask;
            });

    internal sealed class Clients : IGoogleClients
    {
        private readonly List<GoogleClient> known = [];

        public void Add(GoogleClient client) => known.Add(client);

        public void Clear() => known.Clear();

        public GoogleClient? Current => known.FirstOrDefault();

        public GoogleClient? ById(string id) => known.FirstOrDefault(each => each.Id == id);
    }
}
