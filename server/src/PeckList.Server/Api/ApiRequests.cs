using System.ComponentModel;

namespace PeckList.Server.Api;

// The bodies the task API's writes take, for the OpenAPI document only: the routes read the JSON
// themselves (TaskInput, NamedInput), so that a field left out and a field sent as null differ.

/// <summary>A schedule: a date (2026-11-10) or a local date-time (2026-11-10T09:00), with an optional end.</summary>
public sealed record ApiScheduleInput(
    string Start,
    string? End = null,
    bool? AllDay = null,
    [property: Description("An IANA zone such as America/Chicago; left out, the account's zone.")] string? TimeZone = null);

/// <summary>A due date: a date or a local date-time.</summary>
public sealed record ApiDueInput(
    string At,
    bool? AllDay = null,
    [property: Description("An IANA zone such as America/Chicago; left out, the account's zone.")] string? TimeZone = null);

/// <summary>
/// A task to make (title required) or the fields to change. Fields left out are left alone; null
/// clears one. Tags are names: unknown ones are made. Send <c>tags</c> for the whole set, or
/// <c>addTags</c> and <c>removeTags</c>.
/// </summary>
public sealed record ApiTaskInput(
    [property: Description("Your own id for a new task, a ULID (makes a retry safe); on create only.")] string? Id = null,
    string? Title = null,
    string? Notes = null,
    string? ListId = null,
    string? SectionId = null,
    string? ParentId = null,
    [property: Description("open, done or wontdo; on change only. Prefer /complete and /reopen.")] string? Status = null,
    [property: Description("0 none, 1 low, 2 medium, 3 high.")] int? Priority = null,
    ApiScheduleInput? Schedule = null,
    ApiDueInput? Due = null,
    IReadOnlyList<string>? Tags = null,
    IReadOnlyList<string>? AddTags = null,
    IReadOnlyList<string>? RemoveTags = null,
    [property: Description("Principals: user:<id> or group:<id>.")] IReadOnlyList<string>? Assignees = null,
    [property: Description("An RRULE such as FREQ=WEEKLY;BYDAY=SA.")] string? Recurrence = null,
    [property: Description("0 to 100.")] int? Progress = null,
    bool? Pinned = null);

/// <summary>A line of text read as the app's quick add reads it.</summary>
public sealed record ApiQuickAddInput(
    [property: Description("At most 1000 characters, e.g. \"Pay rent tomorrow #bills ^home !high every month\".")] string Text,
    [property: Description("Your own id for the new task, a ULID.")] string? Id = null,
    [property: Description("The list when the text names none with ^.")] string? ListId = null,
    [property: Description("The zone dates are read in; left out, the account's zone.")] string? TimeZone = null);

/// <summary>How the task was closed.</summary>
public sealed record ApiCompleteInput([property: Description("done (the default) or wontdo.")] string? Status = null);

/// <summary>A list to make (name required) or rename.</summary>
public sealed record ApiListInput(string? Id = null, string? Name = null, [property: Description("#RRGGBB.")] string? Color = null);

/// <summary>A section to make (name and listId required) or rename.</summary>
public sealed record ApiSectionInput(string? Id = null, string? Name = null, string? ListId = null);
