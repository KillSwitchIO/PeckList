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
            // The same file may have arrived meanwhile: either copy is the same bytes.
            File.Move(temporary, target, overwrite: true);
            return PutResult.Stored;
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
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

    public Task DeleteAsync(string sha256, CancellationToken cancellation = default)
    {
        if (AttachmentHash.IsValid(sha256) && File.Exists(PathOf(sha256))) File.Delete(PathOf(sha256));
        return Task.CompletedTask;
    }
}
