using PeckList.Core.Sharing;
using PeckList.Core.Text;
using PeckList.Server.Push;

namespace PeckList.Server.Text;

/// <summary>
/// The server's words for one person (PL-148): their picked language from their synced settings,
/// else the languages their device asks for, else English (<see cref="TextLanguage"/>).
/// </summary>
public sealed class ServerWords(ITextCatalog catalog, SharingState sharing)
{
    public ITextCatalog Catalog => catalog;

    /// <summary>For <paramref name="userId"/> (null: nobody known yet), on a device asking for <paramref name="device"/>.</summary>
    public Words For(string? userId, IEnumerable<string>? device = null) =>
        TextLanguage.For(catalog, userId is null ? null : ReminderSender.SettingsOf(sharing.Index, userId), device);

    /// <summary>For <paramref name="userId"/>, with the request's <c>Accept-Language</c> as the device's languages.</summary>
    public Words For(string? userId, HttpRequest request) => For(userId, AcceptLanguage.Tags(request.Headers.AcceptLanguage));
}
