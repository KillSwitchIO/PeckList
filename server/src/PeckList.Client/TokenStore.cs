using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PeckList.Client;

/// <summary>What the CLI keeps for one profile: the server, the key's token, and who it signs in as.</summary>
public sealed record CliProfile(string Server, string Token, string? KeyId, string? Account);

/// <summary>Where the token file cannot be trusted or read: the message says how to fix it.</summary>
public sealed class TokenFileException(string message) : Exception(message);

/// <summary>
/// Where the CLI keeps its sign-ins, by profile name (PL-133). Adapters: a file per user
/// (<see cref="FileTokenStore"/>) and memory for tests; a desktop keyring could come later.
/// </summary>
public interface ITokenStore
{
    /// <summary>Where the sign-ins are kept, to say so in messages.</summary>
    string Where { get; }

    Task<CliProfile?> LoadAsync(string profile, CancellationToken cancellation = default);

    Task SaveAsync(string profile, CliProfile value, CancellationToken cancellation = default);

    /// <summary>False when there was nothing to remove.</summary>
    Task<bool> RemoveAsync(string profile, CancellationToken cancellation = default);
}

public sealed class MemoryTokenStore : ITokenStore
{
    private readonly Dictionary<string, CliProfile> profiles = new(StringComparer.Ordinal);

    public string Where => "memory";

    public Task<CliProfile?> LoadAsync(string profile, CancellationToken cancellation = default) =>
        Task.FromResult(profiles.GetValueOrDefault(profile));

    public Task SaveAsync(string profile, CliProfile value, CancellationToken cancellation = default)
    {
        profiles[profile] = value;
        return Task.CompletedTask;
    }

    public Task<bool> RemoveAsync(string profile, CancellationToken cancellation = default) => Task.FromResult(profiles.Remove(profile));
}

/// <summary>Turns a token into what is written to disk and back.</summary>
public interface ITokenProtector
{
    string Protect(string token);

    string Unprotect(string stored);
}

/// <summary>
/// The token file: <c>{"profiles": {"default": {"server", "token", "keyId", "account"}}}</c>.
/// On Windows the token is encrypted for the current Windows user (DPAPI). Elsewhere the folder is
/// <c>0700</c> and the file <c>0600</c>, created with those modes and replaced by a rename; a file
/// that others may read, or that belongs to someone else, is refused, as ssh does.
/// </summary>
public sealed class FileTokenStore(string path, ITokenProtector protector) : ITokenStore
{
    public string Path { get; } = path;

    public string Where => Path;

    /// <summary>The file for the person running the CLI, with the protection their system has.</summary>
    public static FileTokenStore ForThisUser(Func<string, string?> environment)
    {
        if (OperatingSystem.IsWindows())
        {
            var appData = environment("APPDATA") is { Length: > 0 } roaming ? roaming : Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return new FileTokenStore(System.IO.Path.Combine(appData, "PeckList", "cli.json"), new DpapiProtector());
        }
        var config = environment("XDG_CONFIG_HOME") is { Length: > 0 } xdg
            ? xdg
            : System.IO.Path.Combine(environment("HOME") ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config");
        return new FileTokenStore(System.IO.Path.Combine(config, "pecklist", "cli.json"), new PlainProtector());
    }

    public async Task<CliProfile?> LoadAsync(string profile, CancellationToken cancellation = default)
    {
        var document = await ReadAsync(cancellation);
        if (document?["profiles"]?[profile] is not JsonObject saved) return null;
        var server = (string?)saved["server"];
        var stored = (string?)saved["token"];
        if (server is null || stored is null) return null;
        return new CliProfile(server, protector.Unprotect(stored), (string?)saved["keyId"], (string?)saved["account"]);
    }

    public async Task SaveAsync(string profile, CliProfile value, CancellationToken cancellation = default)
    {
        var document = await ReadAsync(cancellation) ?? [];
        if (document["profiles"] is not JsonObject profiles)
        {
            profiles = [];
            document["profiles"] = profiles;
        }
        profiles[profile] = new JsonObject
        {
            ["server"] = value.Server,
            ["token"] = protector.Protect(value.Token),
            ["keyId"] = value.KeyId,
            ["account"] = value.Account,
        };
        await WriteAsync(document, cancellation);
    }

    public async Task<bool> RemoveAsync(string profile, CancellationToken cancellation = default)
    {
        var document = await ReadAsync(cancellation);
        if (document?["profiles"] is not JsonObject profiles || !profiles.Remove(profile)) return false;
        await WriteAsync(document, cancellation);
        return true;
    }

    private async Task<JsonObject?> ReadAsync(CancellationToken cancellation)
    {
        if (!File.Exists(Path)) return null;
        if (!OperatingSystem.IsWindows()) CheckUnixFile(Path);
        try
        {
            return JsonNode.Parse(await File.ReadAllTextAsync(Path, cancellation)) as JsonObject
                ?? throw new TokenFileException($"{Path} is not a PeckList sign-in file; move it away and sign in again");
        }
        catch (JsonException)
        {
            throw new TokenFileException($"{Path} is damaged; move it away and sign in again");
        }
    }

    [UnsupportedOSPlatform("windows")]
    private static void CheckUnixFile(string file)
    {
        var mode = File.GetUnixFileMode(file);
        const UnixFileMode others = UnixFileMode.GroupRead | UnixFileMode.GroupWrite | UnixFileMode.GroupExecute
            | UnixFileMode.OtherRead | UnixFileMode.OtherWrite | UnixFileMode.OtherExecute;
        if ((mode & others) != 0) throw new TokenFileException($"{file} can be read by others; run: chmod 600 {file}");
        // Only the owner (or root) may change a file's mode: setting it to what it is tells.
        try
        {
            File.SetUnixFileMode(file, mode);
        }
        catch (UnauthorizedAccessException)
        {
            throw new TokenFileException($"{file} belongs to another user; move it away and sign in again");
        }
    }

    private async Task WriteAsync(JsonObject document, CancellationToken cancellation)
    {
        var folder = System.IO.Path.GetDirectoryName(Path)!;
        // A name nobody can guess, made new: never a file someone left there.
        var temp = System.IO.Path.Combine(folder, $".cli.json.{Guid.NewGuid():N}.tmp");
        var bytes = Encoding.UTF8.GetBytes(document.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write };
        if (OperatingSystem.IsWindows())
        {
            Directory.CreateDirectory(folder);
        }
        else
        {
            Directory.CreateDirectory(folder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            CheckUnixFolder(folder);
            options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        }
        try
        {
            await using (var stream = new FileStream(temp, options)) await stream.WriteAsync(bytes, cancellation);
            File.Move(temp, Path, overwrite: true);
        }
        finally
        {
            File.Delete(temp);
        }
    }

    /// <summary>
    /// The folder the file lives in is the owner's alone: one made earlier, or by hand, with room for
    /// others is closed to 0700; one that belongs to someone else is refused.
    /// </summary>
    [UnsupportedOSPlatform("windows")]
    private static void CheckUnixFolder(string folder)
    {
        try
        {
            // Only the owner (or root) may change a folder's mode, so this checks the owner too.
            File.SetUnixFileMode(folder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
        catch (UnauthorizedAccessException)
        {
            throw new TokenFileException($"{folder} belongs to another user; move it away and sign in again");
        }
    }
}

/// <summary>On Unix the file's mode protects the token; it is written as it is.</summary>
public sealed class PlainProtector : ITokenProtector
{
    public string Protect(string token) => token;

    public string Unprotect(string stored) =>
        stored.StartsWith(DpapiProtector.Prefix, StringComparison.Ordinal)
            ? throw new TokenFileException("this sign-in was saved on Windows and only works there; sign in again")
            : stored;
}

/// <summary>
/// The token encrypted for the current Windows user (DPAPI, CurrentUser): the file copied to
/// another account or machine gives nothing usable. It does not protect against a program running
/// as the same user.
/// </summary>
public sealed partial class DpapiProtector : ITokenProtector
{
    public const string Prefix = "dpapi:";

    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("PeckList CLI token");

    public string Protect(string token)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("DPAPI is Windows only");
        return Prefix + Convert.ToBase64String(Crypt(Encoding.UTF8.GetBytes(token), protect: true));
    }

    public string Unprotect(string stored)
    {
        if (!stored.StartsWith(Prefix, StringComparison.Ordinal)) throw new TokenFileException("the saved sign-in is not encrypted; sign in again");
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("DPAPI is Windows only");
        try
        {
            return Encoding.UTF8.GetString(Crypt(Convert.FromBase64String(stored[Prefix.Length..]), protect: false));
        }
        catch (Exception error) when (error is FormatException or System.ComponentModel.Win32Exception)
        {
            throw new TokenFileException("the saved sign-in cannot be read by this Windows user; sign in again");
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Blob
    {
        public int Size;
        public IntPtr Data;
    }

    private const int UiForbidden = 0x1;

    [SupportedOSPlatform("windows")]
    private static byte[] Crypt(byte[] input, bool protect)
    {
        var data = GCHandle.Alloc(input, GCHandleType.Pinned);
        var entropy = GCHandle.Alloc(Entropy, GCHandleType.Pinned);
        try
        {
            var inBlob = new Blob { Size = input.Length, Data = data.AddrOfPinnedObject() };
            var entropyBlob = new Blob { Size = Entropy.Length, Data = entropy.AddrOfPinnedObject() };
            Blob outBlob;
            var ok = protect
                ? CryptProtectData(ref inBlob, IntPtr.Zero, ref entropyBlob, IntPtr.Zero, IntPtr.Zero, UiForbidden, out outBlob)
                : CryptUnprotectData(ref inBlob, IntPtr.Zero, ref entropyBlob, IntPtr.Zero, IntPtr.Zero, UiForbidden, out outBlob);
            if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastPInvokeError());
            try
            {
                var output = new byte[outBlob.Size];
                Marshal.Copy(outBlob.Data, output, 0, outBlob.Size);
                return output;
            }
            finally
            {
                LocalFree(outBlob.Data);
            }
        }
        finally
        {
            data.Free();
            entropy.Free();
        }
    }

    [LibraryImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    [SupportedOSPlatform("windows")]
    private static partial bool CryptProtectData(ref Blob dataIn, IntPtr description, ref Blob entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob dataOut);

    [LibraryImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    [SupportedOSPlatform("windows")]
    private static partial bool CryptUnprotectData(ref Blob dataIn, IntPtr description, ref Blob entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob dataOut);

    [LibraryImport("kernel32.dll")]
    [SupportedOSPlatform("windows")]
    private static partial IntPtr LocalFree(IntPtr memory);
}
