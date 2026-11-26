using System.Globalization;
using System.Xml;
using System.Xml.Linq;

namespace PeckList.CalDav.Dav;

/// <summary>One propstat of a multistatus response: the status and the properties it covers.</summary>
public sealed record DavPropStat(int Status, XElement Prop);

/// <summary>One response in a multistatus: the href, a status of its own (sync-collection removals) and its propstats.</summary>
public sealed record DavResponse(string Href, int? Status, IReadOnlyList<DavPropStat> PropStats)
{
    /// <summary>The named property from a 2xx propstat, or null.</summary>
    public XElement? Ok(XName name) =>
        PropStats.Where(p => p.Status is >= 200 and < 300).Select(p => p.Prop.Element(name)).FirstOrDefault(e => e is not null);

    /// <summary>The text of the named property from a 2xx propstat, or null when it is missing or empty.</summary>
    public string? OkText(XName name) => Ok(name)?.Value.Trim() is { Length: > 0 } text ? text : null;
}

/// <summary>A parsed multistatus (RFC 4918 13), with the sync token of a sync-collection answer.</summary>
public sealed record DavMultistatus(IReadOnlyList<DavResponse> Responses, string? SyncToken);

/// <summary>
/// WebDAV and CalDAV XML: the namespaces, request bodies, and reading multistatus answers. The
/// reader never processes a DTD, so a server can't use entities to read files or blow up memory.
/// </summary>
public static class DavXml
{
    /// <summary>DAV: (RFC 4918).</summary>
    public static readonly XNamespace D = "DAV:";

    /// <summary>CalDAV (RFC 4791).</summary>
    public static readonly XNamespace C = "urn:ietf:params:xml:ns:caldav";

    /// <summary>Calendar Server extensions (getctag).</summary>
    public static readonly XNamespace CS = "http://calendarserver.org/ns/";

    /// <summary>Apple's iCal extensions (calendar-color).</summary>
    public static readonly XNamespace A = "http://apple.com/ns/ical/";

    private static readonly XmlReaderSettings Settings = new()
    {
        DtdProcessing = DtdProcessing.Prohibit,
        XmlResolver = null,
        IgnoreComments = true,
        IgnoreProcessingInstructions = true,
        IgnoreWhitespace = true,
        MaxCharactersFromEntities = 0,
    };

    /// <summary>
    /// The most nodes (elements, attributes, text) one answer may have. A sync listing of about
    /// 100,000 events fits; past that, a byte-capped answer of empty elements could still build a
    /// tree of several hundred MB.
    /// </summary>
    public const int MaxNodes = 2_000_000;

    /// <summary>Parses an XML answer.</summary>
    /// <exception cref="XmlException">The text isn't well-formed XML, has a DTD, or has more than <see cref="MaxNodes"/> nodes.</exception>
    public static XDocument Parse(string text)
    {
        using var reader = new CountingReader(XmlReader.Create(new StringReader(text), Settings), MaxNodes);
        return XDocument.Load(reader);
    }

    /// <summary>Passes everything through to the reader it wraps, counting the nodes and attributes read.</summary>
    private sealed class CountingReader(XmlReader inner, int limit) : XmlReader
    {
        private int count;

        private bool Count(bool moved)
        {
            if (moved && ++count > limit) throw new XmlException("the answer has too many XML nodes");
            return moved;
        }

        public override bool Read() => Count(inner.Read());
        public override bool MoveToFirstAttribute() => Count(inner.MoveToFirstAttribute());
        public override bool MoveToNextAttribute() => Count(inner.MoveToNextAttribute());
        public override int AttributeCount => inner.AttributeCount;
        public override string BaseURI => inner.BaseURI;
        public override int Depth => inner.Depth;
        public override bool EOF => inner.EOF;
        public override bool IsEmptyElement => inner.IsEmptyElement;
        public override string LocalName => inner.LocalName;
        public override string NamespaceURI => inner.NamespaceURI;
        public override XmlNameTable NameTable => inner.NameTable;
        public override XmlNodeType NodeType => inner.NodeType;
        public override string Prefix => inner.Prefix;
        public override ReadState ReadState => inner.ReadState;
        public override string Value => inner.Value;
        public override string GetAttribute(int i) => inner.GetAttribute(i);
        public override string? GetAttribute(string name) => inner.GetAttribute(name);
        public override string? GetAttribute(string name, string? namespaceURI) => inner.GetAttribute(name, namespaceURI);
        public override string? LookupNamespace(string prefix) => inner.LookupNamespace(prefix);
        public override bool MoveToAttribute(string name) => inner.MoveToAttribute(name);
        public override bool MoveToAttribute(string name, string? ns) => inner.MoveToAttribute(name, ns);
        public override bool MoveToElement() => inner.MoveToElement();
        public override bool ReadAttributeValue() => inner.ReadAttributeValue();
        public override void ResolveEntity() => inner.ResolveEntity();

        protected override void Dispose(bool disposing)
        {
            if (disposing) inner.Dispose();
            base.Dispose(disposing);
        }
    }

    /// <summary>Reads a multistatus answer.</summary>
    public static DavMultistatus Multistatus(string text)
    {
        var root = Parse(text).Root;
        if (root is null || root.Name != D + "multistatus") throw new XmlException("not a DAV:multistatus");
        var responses = new List<DavResponse>();
        foreach (var response in root.Elements(D + "response"))
        {
            var href = response.Element(D + "href")?.Value.Trim();
            if (string.IsNullOrEmpty(href)) continue;
            var propStats = response.Elements(D + "propstat")
                .Select(p => (Status: Status(p.Element(D + "status")?.Value), Prop: p.Element(D + "prop")))
                .Where(p => p.Status is not null && p.Prop is not null)
                .Select(p => new DavPropStat(p.Status!.Value, p.Prop!))
                .ToList();
            responses.Add(new DavResponse(href, Status(response.Element(D + "status")?.Value), propStats));
        }
        return new DavMultistatus(responses, root.Element(D + "sync-token")?.Value.Trim() is { Length: > 0 } token ? token : null);
    }

    /// <summary>The code in a status line (<c>HTTP/1.1 404 Not Found</c>), or null.</summary>
    public static int? Status(string? line)
    {
        if (line is null) return null;
        var parts = line.Trim().Split(' ', 3, StringSplitOptions.RemoveEmptyEntries);
        return parts.Length >= 2 && int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var code) ? code : null;
    }

    /// <summary>
    /// True when an error body names the RFC 6578 precondition for a sync token the server no
    /// longer accepts.
    /// </summary>
    public static bool IsInvalidSyncToken(string body)
    {
        try
        {
            return Parse(body).Root?.Element(D + "valid-sync-token") is not null;
        }
        catch (XmlException)
        {
            return false;
        }
    }

    /// <summary>A PROPFIND body asking for the named properties.</summary>
    public static string PropFind(params XName[] properties) =>
        Body(new XElement(D + "propfind", new XElement(D + "prop", properties.Select(p => new XElement(p)))));

    /// <summary>The sync-collection REPORT (RFC 6578 3.2), asking for etags.</summary>
    public static string SyncCollection(string? token) =>
        Body(new XElement(D + "sync-collection",
            new XElement(D + "sync-token", token ?? ""),
            new XElement(D + "sync-level", "1"),
            new XElement(D + "prop", new XElement(D + "getetag"))));

    /// <summary>The calendar-multiget REPORT (RFC 4791 7.9) for these paths.</summary>
    public static string Multiget(IEnumerable<string> paths) =>
        Body(new XElement(C + "calendar-multiget",
            new XElement(D + "prop", new XElement(D + "getetag"), new XElement(C + "calendar-data")),
            paths.Select(p => new XElement(D + "href", p))));

    /// <summary>
    /// The calendar-query REPORT (RFC 4791 7.8) for VEVENTs, within a time range when one is
    /// given, with the data or only the etags.
    /// </summary>
    public static string Query(DateTimeOffset? from, DateTimeOffset? to, bool withData)
    {
        var events = new XElement(C + "comp-filter", new XAttribute("name", "VEVENT"));
        if (from is not null || to is not null)
        {
            var range = new XElement(C + "time-range");
            if (from is not null) range.Add(new XAttribute("start", ICalendar.CalValues.FormatUtc(from.Value)));
            if (to is not null) range.Add(new XAttribute("end", ICalendar.CalValues.FormatUtc(to.Value)));
            events.Add(range);
        }
        var prop = new XElement(D + "prop", new XElement(D + "getetag"));
        if (withData) prop.Add(new XElement(C + "calendar-data"));
        return Body(new XElement(C + "calendar-query", prop,
            new XElement(C + "filter", new XElement(C + "comp-filter", new XAttribute("name", "VCALENDAR"), events))));
    }

    /// <summary>The MKCALENDAR body (RFC 4791 5.3.1) for an event calendar with this name.</summary>
    public static string MakeCalendar(string name) =>
        Body(new XElement(C + "mkcalendar",
            new XElement(D + "set", new XElement(D + "prop",
                new XElement(D + "displayname", name),
                new XElement(C + "supported-calendar-component-set", new XElement(C + "comp", new XAttribute("name", "VEVENT")))))));

    private static string Body(XElement root)
    {
        // Declare the namespaces once on the root, with the prefixes servers expect to see.
        root.SetAttributeValue(XNamespace.Xmlns + "d", D.NamespaceName);
        root.SetAttributeValue(XNamespace.Xmlns + "c", C.NamespaceName);
        if (root.Descendants().Any(e => e.Name.Namespace == CS)) root.SetAttributeValue(XNamespace.Xmlns + "cs", CS.NamespaceName);
        if (root.Descendants().Any(e => e.Name.Namespace == A)) root.SetAttributeValue(XNamespace.Xmlns + "a", A.NamespaceName);
        return new XDocument(new XDeclaration("1.0", "utf-8", null), root).Declaration + "\n" + root.ToString(SaveOptions.DisableFormatting);
    }
}
