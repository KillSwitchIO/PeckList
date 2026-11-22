using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using PeckList.Core.Attachments;

namespace PeckList.Server.Attachments;

/// <summary>
/// Attachment files in a folder (<c>ATTACHMENT_DIR</c>), as <c>ab/abcdef...</c> by their SHA-256.
/// A file is written to a temporary name while it is hashed and only moved into place when it
/// matches, so a half-sent or wrong upload never shows up.
/// </summary>
public sealed class FileAttachmentStore(string folder) : IAttachmentStore
{
    // An upload putting its bytes in place and the clean-up deleting them take turns (Dev 2,
    // file-holders): the hashing stays outside, only the few file operations wait. Shared by every
    // store on the folder in this process.
    private static readonly SemaphoreSlim Turn = new(1, 1);

    private string PathOf(string sha256) =>
        AttachmentHash.IsValid(sha256)
            ? Path.Combine(folder, sha256[..2], sha256)
            : throw new ArgumentException("not a SHA-256", nameof(sha256));

    public Task<bool> ExistsAsync(string sha256, CancellationToken cancellation = default) =>
        Task.FromResult(AttachmentHash.IsValid(sha256) && File.Exists(PathOf(sha256)));

    public async Task<PutResult> PutAsync(string sha256, Stream content, long maxBytes, CancellationToken cancellation = default)
    {
        var target = PathOf(sha256);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        var temporary = Path.Combine(Path.GetDirectoryName(target)!, $".{sha256}.{Guid.NewGuid():N}.part");
        try
        {
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            await using (var file = File.Create(temporary))
            {
                var buffer = new byte[81920];
                long total = 0;
                int read;
                while ((read = await content.ReadAsync(buffer, cancellation)) > 0)
                {
                    total += read;
                    if (total > maxBytes) return PutResult.TooLarge;
                    hash.AppendData(buffer, 0, read);
                    await file.WriteAsync(buffer.AsMemory(0, read), cancellation);
                }
            }
            if (Convert.ToHexStringLower(hash.GetHashAndReset()) != sha256) return PutResult.Mismatch;
            await Turn.WaitAsync(cancellation);
            try
            {
                return Place(temporary, target);
            }
            finally
            {
                Turn.Release();
            }
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    private static PutResult Place(string temporary, string target)
    {
        if (File.Exists(target))
        {
            // The same bytes are here already (uploads always send them now): keep that copy,
            // which a reader may have open, and only mark it written now, so the clean-up keeps
            // it for the attachment about to name it, as it would a new file.
            try
            {
                File.SetLastWriteTimeUtc(target, DateTime.UtcNow);
                return PutResult.Stored;
            }
            catch (IOException)
            {
                // Busy this moment: the new copy goes in its place instead, written now too. Busy
                // as well: the copy is there either way.
                try
                {
                    File.Move(temporary, target, overwrite: true);
                }
                catch (IOException)
                {
                }
                return PutResult.Stored;
            }
        }
        // The same file may have arrived meanwhile: either copy is the same bytes.
        File.Move(temporary, target, overwrite: true);
        return PutResult.Stored;
    }

    public Task<Stream?> OpenAsync(string sha256, CancellationToken cancellation = default)
    {
        if (!AttachmentHash.IsValid(sha256) || !File.Exists(PathOf(sha256))) return Task.FromResult<Stream?>(null);
        return Task.FromResult<Stream?>(new FileStream(PathOf(sha256), FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true));
    }

    public async IAsyncEnumerable<(string Sha256, DateTimeOffset Written)> ListAsync([EnumeratorCancellation] CancellationToken cancellation = default)
    {
        if (!Directory.Exists(folder)) yield break;
        foreach (var path in Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories))
        {
            cancellation.ThrowIfCancellationRequested();
            var name = Path.GetFileName(path);
            if (AttachmentHash.IsValid(name)) yield return (name, new DateTimeOffset(File.GetLastWriteTimeUtc(path), TimeSpan.Zero));
        }
        await Task.CompletedTask;
    }

    public async Task<bool> DeleteIfOlderAsync(
        string sha256, DateTimeOffset writtenBefore, Func<CancellationToken, bool> stillUnused,
        Func<CancellationToken, Task> deleted, CancellationToken cancellation = default)
    {
        if (!AttachmentHash.IsValid(sha256)) return false;
        var path = PathOf(sha256);
        await Turn.WaitAsync(cancellation);
        try
        {
            if (!File.Exists(path) || File.GetLastWriteTimeUtc(path) >= writtenBefore.UtcDateTime || !stillUnused(cancellation)) return false;
            File.Delete(path);
            await deleted(cancellation);
            return true;
        }
        finally
        {
            Turn.Release();
        }
    }
}
