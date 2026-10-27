using System.Globalization;

namespace Punchlist.Core;

public static class TimeStamps
{
    /// <summary>The time in a file name: <c>20261026-173000</c>, UTC.</summary>
    public const string FileFormat = "yyyyMMdd-HHmmss";

    /// <summary>Now, as a file name wants it (<see cref="FileFormat"/>).</summary>
    public static string FileStamp(this TimeProvider time) => time.GetUtcNow().ToString(FileFormat, CultureInfo.InvariantCulture);
}
