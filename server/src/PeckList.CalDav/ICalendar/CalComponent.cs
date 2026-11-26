namespace PeckList.CalDav.ICalendar;

/// <summary>
/// One parameter of a property (<c>TZID=Europe/Berlin</c>, <c>VALUE=DATE</c>), its values unquoted.
/// </summary>
public sealed record CalParameter(string Name, IReadOnlyList<string> Values)
{
    /// <summary>The first value, which is the only one for every parameter the adapter reads.</summary>
    public string Value => Values.Count > 0 ? Values[0] : "";
}

/// <summary>
/// One iCalendar property (RFC 5545 3.1). <see cref="Value"/> is the value as written, still
/// escaped; <see cref="CalText"/> turns TEXT values into strings and back.
/// </summary>
/// <remarks>
/// A parsed property keeps its original line, and the writer prints that line again until the
/// property is changed. That way properties PeckList doesn't understand (attendees, alarms, a
/// client's X- properties) go back to the server byte for byte when an event is edited here
/// (spec: PL-134, editing an event writes back to the calendar).
/// </remarks>
public sealed class CalProperty
{
    private string value;
    private List<CalParameter> parameters;

    /// <summary>A new property with no parameters.</summary>
    public CalProperty(string name, string value, IEnumerable<CalParameter>? parameters = null)
    {
        Name = name.ToUpperInvariant();
        this.value = value;
        this.parameters = parameters?.ToList() ?? [];
    }

    internal CalProperty(string name, string value, List<CalParameter> parameters, string raw)
        : this(name, value, parameters) => Raw = raw;

    /// <summary>The property name, upper case.</summary>
    public string Name { get; }

    /// <summary>The value as written (escaped). Setting it drops the original line.</summary>
    public string Value
    {
        get => value;
        set
        {
            this.value = value;
            Raw = null;
        }
    }

    /// <summary>The parameters in their written order.</summary>
    public IReadOnlyList<CalParameter> Parameters => parameters;

    /// <summary>The unfolded line this property was parsed from, while it is unchanged.</summary>
    internal string? Raw { get; private set; }

    /// <summary>The first value of the named parameter, or null.</summary>
    public string? Param(string name) =>
        parameters.FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))?.Value;

    /// <summary>Sets a parameter to one value, or removes it when <paramref name="paramValue"/> is null.</summary>
    public CalProperty SetParam(string name, string? paramValue)
    {
        parameters = parameters.Where(p => !string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)).ToList();
        if (paramValue is not null) parameters.Add(new CalParameter(name.ToUpperInvariant(), [paramValue]));
        Raw = null;
        return this;
    }
}

/// <summary>
/// A component (VCALENDAR, VEVENT, VTIMEZONE, VALARM, ...) with its properties and nested
/// components, in the order they were written.
/// </summary>
public sealed class CalComponent(string name)
{
    /// <summary>The component name, upper case.</summary>
    public string Name { get; } = name.ToUpperInvariant();

    /// <summary>The properties, in order.</summary>
    public List<CalProperty> Properties { get; } = [];

    /// <summary>The nested components, in order.</summary>
    public List<CalComponent> Children { get; } = [];

    /// <summary>The first property with this name, or null.</summary>
    public CalProperty? Property(string propertyName) =>
        Properties.FirstOrDefault(p => p.Name == propertyName.ToUpperInvariant());

    /// <summary>Every property with this name.</summary>
    public IEnumerable<CalProperty> All(string propertyName)
    {
        var upper = propertyName.ToUpperInvariant();
        return Properties.Where(p => p.Name == upper);
    }

    /// <summary>The nested components with this name.</summary>
    public IEnumerable<CalComponent> Components(string componentName)
    {
        var upper = componentName.ToUpperInvariant();
        return Children.Where(c => c.Name == upper);
    }

    /// <summary>
    /// Replaces every property of this name with <paramref name="property"/>, keeping the place of
    /// the first one so an edited event reads in the same order.
    /// </summary>
    public void Set(CalProperty property)
    {
        var at = Properties.FindIndex(p => p.Name == property.Name);
        Remove(property.Name);
        Properties.Insert(at < 0 || at > Properties.Count ? Properties.Count : at, property);
    }

    /// <summary>Removes every property of this name.</summary>
    public void Remove(string propertyName)
    {
        var upper = propertyName.ToUpperInvariant();
        Properties.RemoveAll(p => p.Name == upper);
    }
}
