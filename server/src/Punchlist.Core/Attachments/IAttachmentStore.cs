namespace Punchlist.Core.Attachments;

public enum PutResult
{
    Stored,

    /// <summary>The bytes do not hash to the name they were sent under.</summary>
    Mismatch,

    /// <summary>Over the size limit; nothing kept.</summary>
    TooLarge,
}

/// <summary>
/// Where attachment files live (spec: Data Model, Attachments), each under the lowercase hex
/// SHA-256 of its bytes, so the same file is stored once. Tasks hold only the description
/// (<c>attachments</c> entities). Adapters: the filesystem; S3-compatible later.
/// </summary>
public interface IAttachmentStore
{
    Task<bool> ExistsAsync(string sha256, CancellationToken cancellation = default);

    /// <summary>Keep the bytes if they hash to <paramref name="sha256"/> and fit <paramref name="maxBytes"/>.</summary>
    Task<PutResult> PutAsync(string sha256, Stream content, long maxBytes, CancellationToken cancellation = default);

    /// <summary>The file, or null when there is none.</summary>
    Task<Stream?> OpenAsync(string sha256, CancellationToken cancellation = default);

    /// <summary>Every stored file with when it was written.</summary>
    IAsyncEnumerable<(string Sha256, DateTimeOffset Written)> ListAsync(CancellationToken cancellation = default);

    Task DeleteAsync(string sha256, CancellationToken cancellation = default);
}

public static class AttachmentHash
{
    /// <summary>Lowercase hex SHA-256: 64 characters of 0-9 and a-f.</summary>
    public static bool IsValid(string? sha256) =>
        sha256 is { Length: 64 } && sha256.All(c => c is (>= '0' and <= '9') or (>= 'a' and <= 'f'));
}
