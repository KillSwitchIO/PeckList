using System.Text.Json.Nodes;
using PeckList.Core.Calendars;

namespace PeckList.Core.Tests.Calendars;

public sealed class CalendarMappingTests
{
    private static readonly EventMarker Marker = new("01JDZK6Q1Y9V3W5T7R8P0N2M4K", "01JDZK7A2B3C4D5E6F7G8H9J0K");
    private const string Person = "Europe/London";

    private static JsonObject Task(JsonObject? schedule = null, JsonObject? due = null, string? recurrence = null) => new()
    {
        ["id"] = Marker.TaskId,
        ["title"] = "Dentist",
        ["notes"] = "Bring the form",
        ["schedule"] = schedule,
        ["due"] = due,
        ["recurrence"] = recurrence,
    };

    private static JsonObject Schedule(string start, string? end, bool allDay, string timeZone = "America/Chicago") =>
        new() { ["start"] = start, ["end"] = end, ["allDay"] = allDay, ["timeZone"] = timeZone };

    private static JsonObject Due(string at, bool allDay, string timeZone = "America/Chicago") =>
        new() { ["at"] = at, ["allDay"] = allDay, ["timeZone"] = timeZone };

    [Fact]
    public void A_date_with_no_time_is_an_all_day_event_ending_the_next_day()
    {
        var data = CalendarMapping.EventOf(Task(Schedule("2026-11-03", null, true)), Marker, Person)!;

        Assert.Equal(CalendarTime.Date("2026-11-03"), data.Start);
        Assert.Equal(CalendarTime.Date("2026-11-04"), data.End);
        Assert.True(data.AllDay);
    }

    [Fact]
    public void A_multi_day_schedule_keeps_its_days_with_the_calendars_exclusive_end()
    {
        var data = CalendarMapping.EventOf(Task(Schedule("2026-11-03", "2026-11-05", true)), Marker, Person)!;

        Assert.Equal(CalendarTime.Date("2026-11-06"), data.End);
    }

    [Fact]
    public void A_time_with_no_end_is_a_30_minute_event()
    {
        var data = CalendarMapping.EventOf(Task(Schedule("2026-11-03T23:45", null, false)), Marker, Person)!;

        Assert.Equal(CalendarTime.Local("2026-11-03T23:45", "America/Chicago"), data.Start);
        Assert.Equal(CalendarTime.Local("2026-11-04T00:15", "America/Chicago"), data.End);
    }

    [Fact]
    public void A_start_and_end_make_an_event_of_that_length()
    {
        var data = CalendarMapping.EventOf(Task(Schedule("2026-11-03T09:00", "2026-11-03T10:30", false)), Marker, Person)!;

        Assert.Equal(CalendarTime.Local("2026-11-03T10:30", "America/Chicago"), data.End);
    }

    [Fact]
    public void With_no_schedule_the_due_date_is_used()
    {
        var timed = CalendarMapping.EventOf(Task(due: Due("2026-11-10T17:00", false)), Marker, Person)!;
        var allDay = CalendarMapping.EventOf(Task(due: Due("2026-11-10", true)), Marker, Person)!;

        Assert.Equal(CalendarTime.Local("2026-11-10T17:30", "America/Chicago"), timed.End);
        Assert.Equal(CalendarTime.Date("2026-11-11"), allDay.End);
    }

    [Fact]
    public void The_schedule_wins_over_the_due_date()
    {
        var data = CalendarMapping.EventOf(Task(Schedule("2026-11-03", null, true), Due("2026-11-10", true)), Marker, Person)!;

        Assert.Equal(CalendarTime.Date("2026-11-03"), data.Start);
    }

    [Fact]
    public void A_task_with_no_date_has_no_event()
    {
        Assert.Null(CalendarMapping.EventOf(Task(), Marker, Person));
    }

    [Fact]
    public void A_time_with_no_zone_takes_the_persons()
    {
        var data = CalendarMapping.EventOf(Task(Schedule("2026-11-03T09:00", null, false, "")), Marker, Person)!;

        Assert.Equal(Person, data.Start.TimeZone);
    }

    [Fact]
    public void Title_and_notes_become_summary_and_description_and_the_marker_rides_along()
    {
        var data = CalendarMapping.EventOf(Task(Schedule("2026-11-03", null, true)), Marker, Person)!;

        Assert.Equal("Dentist", data.Summary);
        Assert.Equal("Bring the form", data.Description);
        Assert.Equal(Marker, data.Marker);
    }

    [Fact]
    public void A_repeat_rule_goes_over_with_its_skips_as_exceptions()
    {
        var data = CalendarMapping.EventOf(
            Task(Schedule("2026-11-02T08:00", "2026-11-02T08:30", false), recurrence: "FREQ=WEEKLY;BYDAY=MO;X-PL-SKIP=20261109"), Marker, Person)!;

        Assert.Equal("FREQ=WEEKLY;BYDAY=MO", data.RRule);
        Assert.Equal([CalendarTime.Local("2026-11-09T08:00", "America/Chicago")], data.ExDates!);
    }

    [Fact]
    public void A_rule_counted_from_completion_goes_over_as_a_single_event()
    {
        var data = CalendarMapping.EventOf(Task(Schedule("2026-11-02", null, true), recurrence: "FREQ=DAILY;INTERVAL=3;X-PL-FROM=COMPLETION"), Marker, Person)!;

        Assert.Null(data.RRule);
        Assert.Null(data.ExDates);
    }

    [Fact]
    public void An_all_day_event_becomes_a_schedule_with_an_inclusive_end()
    {
        var one = CalendarMapping.TaskFieldsOf(new EventData("Bins", "", CalendarTime.Date("2026-11-03"), CalendarTime.Date("2026-11-04")), Person);
        var three = CalendarMapping.TaskFieldsOf(new EventData("Trip", "", CalendarTime.Date("2026-11-03"), CalendarTime.Date("2026-11-06")), Person);

        Assert.True(JsonNode.DeepEquals(Schedule("2026-11-03", null, true, Person), one["schedule"]));
        Assert.True(JsonNode.DeepEquals(Schedule("2026-11-03", "2026-11-05", true, Person), three["schedule"]));
    }

    [Fact]
    public void A_timed_event_becomes_a_schedule_in_its_own_zone()
    {
        var fields = CalendarMapping.TaskFieldsOf(
            new EventData("Dentist", "Bring the form", CalendarTime.Local("2026-11-03T09:00", "America/Chicago"), CalendarTime.Local("2026-11-03T10:30", "America/Chicago")), Person);

        Assert.True(JsonNode.DeepEquals(Schedule("2026-11-03T09:00", "2026-11-03T10:30", false), fields["schedule"]));
        Assert.Equal("Dentist", (string?)fields["title"]);
        Assert.Equal("Bring the form", (string?)fields["notes"]);
        Assert.Null(fields["recurrence"]);
    }

    [Fact]
    public void An_end_in_another_zone_is_read_in_the_starts_zone()
    {
        var fields = CalendarMapping.TaskFieldsOf(
            new EventData("Flight", "", CalendarTime.Local("2026-11-03T09:00", "America/Chicago"), CalendarTime.Local("2026-11-03T18:00", "UTC")), Person);

        Assert.Equal("2026-11-03T12:00", (string?)fields["schedule"]!["end"]);
    }

    [Fact]
    public void An_end_in_a_zone_the_server_does_not_know_is_read_as_written()
    {
        var fields = CalendarMapping.TaskFieldsOf(
            new EventData("Odd", "", CalendarTime.Local("2026-11-03T09:00", "America/Chicago"), CalendarTime.Local("2026-11-03T10:00", "Mars/Olympus_Mons")), Person);

        Assert.Equal("2026-11-03T10:00", (string?)fields["schedule"]!["end"]);
    }

    [Fact]
    public void A_timed_event_with_no_end_or_a_floating_time_reads_sensibly()
    {
        var fields = CalendarMapping.TaskFieldsOf(new EventData("Call", "", CalendarTime.Local("2026-11-03T09:00", null), null), Person);

        Assert.True(JsonNode.DeepEquals(Schedule("2026-11-03T09:00", "2026-11-03T09:30", false, Person), fields["schedule"]));
    }

    [Fact]
    public void An_events_rule_and_exceptions_become_the_tasks_rule_and_skips()
    {
        var fields = CalendarMapping.TaskFieldsOf(new EventData("Gym", "", CalendarTime.Date("2026-11-02"), CalendarTime.Date("2026-11-03"),
            "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10", [CalendarTime.Date("2026-11-09")]), Person);

        Assert.Equal("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10;X-PL-SKIP=20261109", (string?)fields["recurrence"]);
    }

    [Fact]
    public void A_rule_the_task_cannot_keep_maps_to_none()
    {
        var fields = CalendarMapping.TaskFieldsOf(new EventData("Odd", "", CalendarTime.Date("2026-11-02"), null, "FREQ=HOURLY"), Person);

        Assert.Null(fields["recurrence"]);
    }

    [Fact]
    public void A_task_and_its_event_map_back_to_the_same_fields()
    {
        var task = Task(Schedule("2026-11-03T09:00", "2026-11-03T10:30", false), recurrence: "FREQ=WEEKLY;BYDAY=TU;X-PL-SKIP=20261110");

        var fields = CalendarMapping.TaskFieldsOf(CalendarMapping.EventOf(task, Marker, Person)!, Person);

        foreach (var field in new[] { "title", "notes", "schedule", "recurrence" }) Assert.True(JsonNode.DeepEquals(task[field], fields[field]), field);
    }

    [Theory]
    [InlineData("2026-11-02", true)]
    [InlineData("2026-11-04", true)]
    [InlineData("2026-11-03", false)]
    [InlineData("2026-11-09", false)]
    [InlineData("2026-10-28", false)]
    public void A_day_is_an_occurrence_when_the_rule_reaches_it_and_it_is_not_left_out(string day, bool expected)
    {
        var series = new EventData("Gym", "", CalendarTime.Date("2026-11-02"), CalendarTime.Date("2026-11-03"), "FREQ=WEEKLY;BYDAY=MO,WE", [CalendarTime.Date("2026-11-09")]);

        Assert.Equal(expected, CalendarMapping.IsOccurrence(series, day));
    }

    [Theory]
    [InlineData("FREQ=WEEKLY;BYDAY=MO;COUNT=10", "FREQ=WEEKLY;BYDAY=MO;COUNT=9", true)]
    [InlineData("FREQ=WEEKLY;BYDAY=MO;X-PL-SKIP=20261109", "FREQ=WEEKLY;BYDAY=MO", true)]
    [InlineData("FREQ=WEEKLY;BYDAY=MO", "FREQ=WEEKLY;BYDAY=TU", false)]
    [InlineData("FREQ=WEEKLY;BYDAY=MO", "FREQ=WEEKLY;BYDAY=MO;COUNT=4", false)]
    [InlineData("FREQ=WEEKLY;BYDAY=MO", null, false)]
    public void Moving_on_keeps_the_same_series(string a, string? b, bool expected)
    {
        Assert.Equal(expected, CalendarMapping.SameSeries(a, b));
    }
}
