using System.Text.Json.Nodes;
using PeckList.Core.Calendars;

namespace PeckList.Calendars.Tests;

public sealed class CalendarSyncTests : IAsyncLifetime
{
    private CalendarRig rig = null!;

    public async ValueTask InitializeAsync() => rig = await CalendarRig.StartAsync();

    public async ValueTask DisposeAsync() => await rig.DisposeAsync();

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static bool Tagged(JsonObject task, string tag = CalendarRig.Tag) =>
        task["tags"] is JsonObject set && set[tag] is JsonObject element && (bool?)element["in"] == true;

    private RemoteEvent OnlyEvent() => Assert.Single(rig.Fake.Events(rig.CalendarId));

    [Fact]
    public async Task A_tagged_task_with_a_date_goes_to_the_calendar_carrying_its_marker()
    {
        var id = await rig.AddTaskAsync("Dentist", CalendarRig.At("2026-11-30T09:00", "2026-11-30T10:00"));
        await rig.AddTaskAsync("Untagged", CalendarRig.Day("2026-11-30"), tagged: false);
        await rig.AddTaskAsync("Undated", null);

        var run = await rig.RunAsync();

        Assert.Equal(1, run.EventsCreated);
        var made = OnlyEvent();
        Assert.Equal("Dentist", made.Data.Summary);
        Assert.Equal(CalendarTime.Local("2026-11-30T10:00", CalendarRig.Zone), made.Data.End);
        Assert.Equal(new EventMarker(await rig.Instance.GetAsync(Token), id), made.Data.Marker);
    }

    [Fact]
    public async Task A_new_event_becomes_a_tagged_task_in_the_inbox_and_learns_its_task()
    {
        var seeded = rig.Fake.Seed(rig.CalendarId, new EventData("Team lunch", "Room 4", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")));

        var run = await rig.RunAsync();

        Assert.Equal(1, run.TasksCreated);
        var task = Assert.Single(await rig.TasksAsync());
        Assert.Equal("Team lunch", (string?)task["title"]);
        Assert.Equal("Room 4", (string?)task["notes"]);
        Assert.Equal(CalendarRig.Inbox, (string?)task["listId"]);
        Assert.True(Tagged(task));
        Assert.Equal("2026-12-02", (string?)task["schedule"]!["start"]);
        Assert.Equal((string)task["id"]!, rig.Fake.Event(rig.CalendarId, seeded.Id)!.Data.Marker?.TaskId);
    }

    [Fact]
    public async Task A_second_run_with_nothing_new_writes_nothing()
    {
        await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-11-30"));
        rig.Fake.Seed(rig.CalendarId, new EventData("Lunch", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")));
        await rig.RunAsync();
        var calls = rig.Fake.Calls;

        var again = await rig.RunAsync();

        Assert.Equal(new CalendarRun(), again);
        Assert.Equal(calls + 1, rig.Fake.Calls); // the changes read, and no write
    }

    [Fact]
    public async Task Edits_on_either_side_reach_the_other()
    {
        var id = await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-11-30"));
        await rig.RunAsync();
        rig.Time.Advance(TimeSpan.FromMinutes(1));

        await rig.EditTaskAsync(id, new JsonObject { ["title"] = "Dentist (moved)" });
        await rig.RunAsync();
        Assert.Equal("Dentist (moved)", OnlyEvent().Data.Summary);

        rig.Time.Advance(TimeSpan.FromMinutes(1));
        rig.Fake.Edit(rig.CalendarId, OnlyEvent().Id, data => data with
        {
            Start = CalendarTime.Local("2026-12-01T15:00", CalendarRig.Zone),
            End = CalendarTime.Local("2026-12-01T16:00", CalendarRig.Zone),
        });
        await rig.RunAsync();

        var task = (await rig.TaskAsync(id))!;
        Assert.True(JsonNode.DeepEquals(CalendarRig.At("2026-12-01T15:00", "2026-12-01T16:00"), task["schedule"]));
        Assert.Equal("Dentist (moved)", (string?)task["title"]);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task When_both_sides_change_the_same_part_the_later_edit_wins(bool calendarLater)
    {
        var id = await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-11-30"));
        await rig.RunAsync();
        var eventId = OnlyEvent().Id;
        // Different parts merge: notes from the calendar land whatever wins the title. First, since
        // a calendar's time of change is the event's, not each field's.
        rig.Time.Advance(TimeSpan.FromMinutes(1));
        rig.Fake.Edit(rig.CalendarId, eventId, data => data with { Description = "Bring the form" });

        rig.Time.Advance(TimeSpan.FromMinutes(1));
        if (calendarLater) await rig.EditTaskAsync(id, new JsonObject { ["title"] = "From PeckList" });
        else rig.Fake.Edit(rig.CalendarId, eventId, data => data with { Summary = "From the calendar" });
        rig.Time.Advance(TimeSpan.FromMinutes(1));
        if (calendarLater) rig.Fake.Edit(rig.CalendarId, eventId, data => data with { Summary = "From the calendar" });
        else await rig.EditTaskAsync(id, new JsonObject { ["title"] = "From PeckList" });
        rig.Time.Advance(TimeSpan.FromMinutes(1));

        await rig.RunAsync();

        var expected = calendarLater ? "From the calendar" : "From PeckList";
        Assert.Equal(expected, (string?)(await rig.TaskAsync(id))!["title"]);
        Assert.Equal(expected, OnlyEvent().Data.Summary);
        Assert.Equal("Bring the form", (string?)(await rig.TaskAsync(id))!["notes"]);
    }

    [Fact]
    public async Task Deleting_the_event_sends_the_task_to_trash()
    {
        var id = await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-11-30"));
        await rig.RunAsync();

        rig.Fake.Remove(rig.CalendarId, OnlyEvent().Id);
        var run = await rig.RunAsync();

        Assert.Equal(1, run.TasksTrashed);
        Assert.NotNull((await rig.TaskAsync(id))!["deletedAt"]);
        Assert.Empty(await rig.Calendars.ItemsAsync(rig.LinkId, Token));
    }

    [Fact]
    public async Task Deleting_the_task_or_taking_its_tag_off_deletes_its_event()
    {
        var deleted = await rig.AddTaskAsync("Deleted", CalendarRig.Day("2026-11-30"));
        var untagged = await rig.AddTaskAsync("Untagged", CalendarRig.Day("2026-12-01"));
        var undated = await rig.AddTaskAsync("Undated", CalendarRig.Day("2026-12-02"));
        await rig.RunAsync();
        Assert.Equal(3, rig.Fake.Events(rig.CalendarId).Count);

        await rig.EditTaskAsync(deleted, new JsonObject { ["deletedAt"] = rig.Clock.Now() });
        await rig.UntagAsync(untagged);
        await rig.EditTaskAsync(undated, new JsonObject { ["schedule"] = null });
        var run = await rig.RunAsync();

        Assert.Equal(3, run.EventsDeleted);
        Assert.Empty(rig.Fake.Events(rig.CalendarId));
        Assert.Null((await rig.TaskAsync(untagged))!["deletedAt"]);
    }

    [Fact]
    public async Task A_task_restored_from_trash_gets_a_new_event()
    {
        var id = await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-11-30"));
        await rig.RunAsync();
        rig.Fake.Remove(rig.CalendarId, OnlyEvent().Id);
        await rig.RunAsync();

        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = null });
        await rig.RunAsync();

        Assert.Equal(id, OnlyEvent().Data.Marker?.TaskId);
    }

    [Fact]
    public async Task Completing_a_task_leaves_the_calendar_alone()
    {
        var id = await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-11-30"));
        await rig.RunAsync();
        var before = OnlyEvent();

        await rig.EditTaskAsync(id, new JsonObject { ["status"] = "done", ["completedAt"] = rig.Clock.Now(), ["completedBy"] = CalendarRig.Ben });
        var run = await rig.RunAsync();

        Assert.Equal(0, run.EventsUpdated + run.EventsDeleted);
        Assert.Equal(before, OnlyEvent());
    }

    [Fact]
    public async Task A_repeating_task_moving_on_leaves_its_series_alone()
    {
        var id = await rig.AddTaskAsync("Gym", CalendarRig.Day("2026-11-30"), recurrence: "FREQ=WEEKLY;BYDAY=MO;COUNT=5");
        await rig.RunAsync();
        var series = OnlyEvent();
        Assert.Equal("FREQ=WEEKLY;BYDAY=MO;COUNT=5", series.Data.RRule);

        // As completing does: the next occurrence, one fewer left.
        await rig.EditTaskAsync(id, new JsonObject { ["schedule"] = CalendarRig.Day("2026-12-07"), ["recurrence"] = "FREQ=WEEKLY;BYDAY=MO;COUNT=4" });
        var run = await rig.RunAsync();

        Assert.Equal(0, run.EventsUpdated);
        Assert.Equal(series, OnlyEvent());
        Assert.Equal("2026-12-07", (string?)(await rig.TaskAsync(id))!["schedule"]!["start"]);
    }

    [Fact]
    public async Task A_repeating_task_moved_to_another_day_moves_its_series()
    {
        var id = await rig.AddTaskAsync("Gym", CalendarRig.Day("2026-11-30"), recurrence: "FREQ=WEEKLY;BYDAY=MO");
        await rig.RunAsync();

        await rig.EditTaskAsync(id, new JsonObject { ["schedule"] = CalendarRig.Day("2026-12-01"), ["recurrence"] = "FREQ=WEEKLY;BYDAY=TU" });
        await rig.RunAsync();

        Assert.Equal(CalendarTime.Date("2026-12-01"), OnlyEvent().Data.Start);
        Assert.Equal("FREQ=WEEKLY;BYDAY=TU", OnlyEvent().Data.RRule);
    }

    [Fact]
    public async Task An_event_changed_between_read_and_write_is_merged_on_the_run_that_follows()
    {
        var id = await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-11-30"));
        await rig.RunAsync();
        await rig.EditTaskAsync(id, new JsonObject { ["title"] = "Dentist (moved)" });

        rig.Fake.RaceNextWrite();
        var run = await rig.RunAsync();

        Assert.Equal(0, run.Conflicts);
        Assert.Equal("Dentist (moved)", OnlyEvent().Data.Summary);
    }

    [Fact]
    public async Task An_expired_sync_token_gets_a_full_listing_and_makes_no_copies()
    {
        await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-11-30"));
        rig.Fake.Seed(rig.CalendarId, new EventData("Lunch", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")));
        await rig.RunAsync();

        rig.Fake.ExpireTokens(rig.CalendarId);
        rig.Fake.Seed(rig.CalendarId, new EventData("Dinner", "", CalendarTime.Date("2026-12-04"), CalendarTime.Date("2026-12-05")));
        var run = await rig.RunAsync();

        Assert.Equal(1, run.TasksCreated);
        Assert.Equal(0, run.EventsCreated);
        Assert.Equal(3, (await rig.TasksAsync()).Count);
        Assert.Equal(3, rig.Fake.Events(rig.CalendarId).Count);
    }

    [Fact]
    public async Task Linking_again_after_the_items_are_lost_pairs_every_event_with_its_task()
    {
        await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-11-30"));
        await rig.AddTaskAsync("Gym", CalendarRig.At("2026-12-01T07:00"), recurrence: "FREQ=DAILY");
        rig.Fake.Seed(rig.CalendarId, new EventData("Lunch", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")));
        await rig.RunAsync();

        // As after a restore, or a disconnect and reconnect: a fresh link, no items, no token, no cursor.
        await rig.Calendars.DeleteLinkAsync(rig.LinkId, Token);
        await rig.Calendars.SaveLinkAsync(CalendarRig.NewLink("link2", rig.CalendarId, CalendarRig.Tag), Token);
        var run = await rig.RunAsync("link2");

        Assert.Equal(0, run.TasksCreated + run.EventsCreated + run.EventsDeleted + run.TasksTrashed);
        Assert.Equal(3, (await rig.TasksAsync()).Count);
        Assert.Equal(3, rig.Fake.Events(rig.CalendarId).Count);
        Assert.Equal(3, (await rig.Calendars.ItemsAsync("link2", Token)).Count(each => each.TaskId is not null));
    }

    [Fact]
    public async Task Another_servers_events_are_left_to_it()
    {
        rig.Fake.Seed(rig.CalendarId, new EventData("Theirs", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03"),
            Marker: new EventMarker("01JDZKOTHERSERVER000000000", "01JDZKOTHERTASK00000000000")));

        var run = await rig.RunAsync();

        Assert.Equal(0, run.TasksCreated);
        Assert.Empty(await rig.TasksAsync());
        Assert.Equal("01JDZKOTHERTASK00000000000", OnlyEvent().Data.Marker?.TaskId);
    }

    [Fact]
    public async Task A_task_with_two_linked_tags_goes_to_both_calendars()
    {
        const string Work = "01JDZKTAGWORK0000000000000";
        await rig.WriteAsync("tags", rig.New(Work, new JsonObject { ["name"] = "work", ["color"] = "#FF6633", ["order"] = "a1" }));
        var workCalendar = rig.Fake.AddCalendar(rig.Connection, "Work");
        await rig.Calendars.SaveLinkAsync(CalendarRig.NewLink("work", workCalendar, Work), Token);
        var id = await rig.AddTaskAsync("Review", CalendarRig.Day("2026-11-30"));
        var task = (await rig.TaskAsync(id))!;
        task["tags"]![Work] = new JsonObject { ["in"] = true, ["hlc"] = rig.Clock.Next() };
        await rig.WriteAsync("tasks", task);

        await rig.RunAsync();
        await rig.RunAsync("work");

        Assert.Equal(id, OnlyEvent().Data.Marker?.TaskId);
        Assert.Equal(id, Assert.Single(rig.Fake.Events(workCalendar)).Data.Marker?.TaskId);
    }

    [Fact]
    public async Task A_failing_service_backs_off_and_a_refused_password_stops_the_account()
    {
        rig.Fake.FailNext(new CalendarProblem(CalendarProblemKind.Unavailable, "calendar_unreachable", "down"), times: 2);

        Assert.Equal("calendar_unreachable", (await rig.RunAsync()).Problem);
        Assert.Equal("calendar_unreachable", (await rig.RunAsync()).Problem);
        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        Assert.Equal(2, link.Failures);
        Assert.Equal(rig.Time.Now + TimeSpan.FromMinutes(2), link.NextAttempt);

        await rig.RunAsync();
        Assert.Equal(0, (await rig.Calendars.LinkAsync(rig.LinkId, Token))!.Failures);

        rig.Fake.ChangePassword(rig.Connection, "changed-on-the-service");
        Assert.Equal("calendar_auth_failed", (await rig.RunAsync()).Problem);
        Assert.Equal(CalendarAccount.AuthFailed, (await rig.Calendars.AccountAsync("acct1", Token))!.Status);
        var calls = rig.Fake.Calls;
        Assert.True((await rig.RunAsync()).Skipped);
        Assert.Equal(calls, rig.Fake.Calls);
    }

    [Fact]
    public void Backoff_doubles_up_to_six_hours_and_honours_retry_after()
    {
        Assert.Equal(TimeSpan.FromMinutes(1), CalendarSync.Backoff(1));
        Assert.Equal(TimeSpan.FromMinutes(8), CalendarSync.Backoff(4));
        Assert.Equal(TimeSpan.FromHours(6), CalendarSync.Backoff(30));
        Assert.Equal(TimeSpan.FromMinutes(20), CalendarSync.Backoff(1, TimeSpan.FromMinutes(20)));
    }

    [Fact]
    public async Task A_calendar_that_never_answers_times_out_and_the_next_calendar_still_syncs()
    {
        const string Work = "01JDZKTAGWORK0000000000000";
        await rig.WriteAsync("tags", rig.New(Work, new JsonObject { ["name"] = "work", ["color"] = "#FF6633", ["order"] = "a1" }));
        var workCalendar = rig.Fake.AddCalendar(rig.Connection, "Work");
        await rig.Calendars.SaveLinkAsync(CalendarRig.NewLink("work", workCalendar, Work), Token);
        rig.Fake.Hang(workCalendar);
        var engine = rig.NewEngine(deadline: TimeSpan.FromMilliseconds(200));
        var id = await rig.AddTaskAsync("Review", CalendarRig.Day("2026-11-30"));

        var stuck = await engine.SyncLinkAsync("work", Token);
        var next = await engine.SyncLinkAsync(rig.LinkId, Token);

        Assert.Equal(CalendarSync.TimedOut, stuck.Problem);
        var link = (await rig.Calendars.LinkAsync("work", Token))!;
        Assert.Equal(CalendarSync.TimedOut, link.Problem);
        Assert.Equal(1, link.Failures);
        Assert.Equal(rig.Time.Now + TimeSpan.FromMinutes(1), link.NextAttempt);
        Assert.Null(next.Problem);
        Assert.Equal(id, OnlyEvent().Data.Marker?.TaskId);
    }

    [Fact]
    public async Task A_failed_run_says_which_call_failed_on_which_event_and_what_the_service_answered()
    {
        rig.Fake.FailNext(new CalendarProblem(CalendarProblemKind.Refused, "calendar_refused", "Google answered 400 (badRequest)"));

        var listing = await rig.RunAsync();

        Assert.Equal("calendar_refused", listing.Problem);
        Assert.Equal("calendar_refused (Google answered 400 (badRequest)) in list", listing.Detail);

        var birthday = rig.Fake.Seed(rig.CalendarId, new EventData("Kim's birthday", "", CalendarTime.Date("2026-12-01"), CalendarTime.Date("2026-12-02")));
        rig.Fake.RefuseWrites(birthday.Id);

        var marking = await rig.RunAsync();

        Assert.Null(marking.Problem);
        Assert.Equal(1, marking.EventsRefused);
        Assert.Equal($"calendar_refused (Google answered 400 (eventTypeRestriction)) in update for event {birthday.Id}", marking.FirstRefusal);
    }

    [Fact]
    public async Task An_event_the_calendar_wont_mark_stays_the_calendars_and_the_rest_still_sync()
    {
        var lunch = rig.Fake.Seed(rig.CalendarId, new EventData("Team lunch", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")));
        var birthday = rig.Fake.Seed(rig.CalendarId, new EventData("Kim's birthday", "", CalendarTime.Date("2026-12-01"), CalendarTime.Date("2026-12-02")));
        var review = rig.Fake.Seed(rig.CalendarId, new EventData("Review", "", CalendarTime.Date("2026-12-04"), CalendarTime.Date("2026-12-05")));
        rig.Fake.RefuseWrites(birthday.Id);
        var dentist = await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-12-07"));

        var run = await rig.RunAsync();

        Assert.Null(run.Problem);
        Assert.Equal(1, run.EventsRefused);
        Assert.Equal(2, run.TasksCreated);
        Assert.Equal(1, run.EventsCreated);
        Assert.Equal(["Dentist", "Review", "Team lunch"], (await rig.TasksAsync()).Select(task => (string)task["title"]!).Order(StringComparer.Ordinal));
        Assert.Null(rig.Fake.Event(rig.CalendarId, birthday.Id)!.Data.Marker);
        Assert.NotNull(rig.Fake.Event(rig.CalendarId, lunch.Id)!.Data.Marker);
        Assert.NotNull(rig.Fake.Event(rig.CalendarId, review.Id)!.Data.Marker);
        var items = await rig.Calendars.ItemsAsync(rig.LinkId, Token);
        Assert.Null(items.Single(item => item.EventId == birthday.Id).TaskId);
        Assert.Contains(items, item => item.TaskId == dentist);
        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        Assert.NotNull(link.SyncToken);
        Assert.Equal(0, link.Failures);

        // Not asked again: the next run writes nothing.
        Assert.Equal(new CalendarRun(), await rig.RunAsync());
    }

    [Fact]
    public async Task A_google_calendar_with_a_birthday_among_many_events_syncs_the_rest_and_never_writes_to_the_birthday()
    {
        await rig.UseGoogleAsync();
        var google = rig.GoogleService!;
        for (var day = 1; day <= 30; day++)
        {
            var date = $"2026-12-{day:00}";
            google.Seed(rig.GoogleAddress, rig.GoogleAddress, new JsonObject
            {
                ["summary"] = $"Event {day:00}",
                ["start"] = new JsonObject { ["date"] = date },
                ["end"] = new JsonObject { ["date"] = DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture).AddDays(1).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture) },
            });
        }
        var birthday = google.Seed(rig.GoogleAddress, rig.GoogleAddress, new JsonObject
        {
            ["summary"] = "Kim's birthday",
            ["eventType"] = "birthday",
            ["start"] = new JsonObject { ["date"] = "2026-12-15" },
            ["end"] = new JsonObject { ["date"] = "2026-12-16" },
            ["recurrence"] = new JsonArray("RRULE:FREQ=YEARLY"),
        });

        var run = await rig.RunAsync();

        Assert.Null(run.Problem);
        Assert.Equal(0, run.EventsRefused);
        Assert.Equal(30, run.TasksCreated);
        Assert.Equal(30, google.Patches.Count);
        Assert.All(google.Patches, patch => Assert.Equal(["extendedProperties"], patch.Body.Select(pair => pair.Key)));
        Assert.DoesNotContain(google.Patches, patch => patch.EventId == (string)birthday["id"]!);
        Assert.Null(google.Event(rig.GoogleAddress, rig.GoogleAddress, (string)birthday["id"]!)!["extendedProperties"]);
        Assert.NotNull((await rig.Calendars.LinkAsync(rig.LinkId, Token))!.SyncToken);
        Assert.Equal(new CalendarRun(), await rig.RunAsync());
    }

    // The rig's clock: 26 November 2026, 09:00 UTC, the person in Europe/London.

    [Fact]
    public async Task Events_before_today_stay_the_calendars_with_nothing_written_to_them()
    {
        var past = rig.Fake.Seed(rig.CalendarId, new EventData("Old lunch", "", CalendarTime.Date("2026-11-20"), CalendarTime.Date("2026-11-21")));
        var yesterday = rig.Fake.Seed(rig.CalendarId, new EventData("Call", "", CalendarTime.Local("2026-11-25T16:00", CalendarRig.Zone), CalendarTime.Local("2026-11-25T16:30", CalendarRig.Zone)));
        var earlierToday = rig.Fake.Seed(rig.CalendarId, new EventData("Standup", "", CalendarTime.Local("2026-11-26T08:00", CalendarRig.Zone), CalendarTime.Local("2026-11-26T08:15", CalendarRig.Zone)));

        var run = await rig.RunAsync();

        Assert.Equal(1, run.TasksCreated);
        Assert.Equal(["Standup"], (await rig.TasksAsync()).Select(task => (string)task["title"]!));
        foreach (var left in new[] { past, yesterday })
        {
            var stored = rig.Fake.Event(rig.CalendarId, left.Id)!;
            Assert.Equal(left.Etag, stored.Etag);
            Assert.Null(stored.Data.Marker);
        }
        Assert.NotNull(rig.Fake.Event(rig.CalendarId, earlierToday.Id)!.Data.Marker);
        // Kept, so the next run passes them by.
        var items = await rig.Calendars.ItemsAsync(rig.LinkId, Token);
        Assert.Null(items.Single(item => item.EventId == past.Id).TaskId);
        var calls = rig.Fake.Calls;
        await rig.Calendars.SaveLinkAsync((await rig.Calendars.LinkAsync(rig.LinkId, Token))! with { SyncToken = null }, Token);
        Assert.Equal(new CalendarRun(), await rig.RunAsync());
        Assert.Equal(calls + 1, rig.Fake.Calls);
    }

    [Fact]
    public async Task A_timed_event_in_another_zone_counts_by_the_persons_day()
    {
        // 23:30 in Chicago on the 25th is 05:30 on the 26th in London: today for the person.
        rig.Fake.Seed(rig.CalendarId, new EventData("Late call", "", CalendarTime.Local("2026-11-25T23:30", "America/Chicago"), CalendarTime.Local("2026-11-26T00:00", "America/Chicago")));
        // 08:00 on the 26th in Tokyo is 23:00 on the 25th in London: yesterday for the person.
        rig.Fake.Seed(rig.CalendarId, new EventData("Early", "", CalendarTime.Local("2026-11-26T08:00", "Asia/Tokyo"), CalendarTime.Local("2026-11-26T08:30", "Asia/Tokyo")));

        await rig.RunAsync();

        Assert.Equal(["Late call"], (await rig.TasksAsync()).Select(task => (string)task["title"]!));
    }

    [Theory]
    [InlineData("FREQ=WEEKLY;BYDAY=TH", true)]
    [InlineData("FREQ=WEEKLY;BYDAY=TH;UNTIL=20261101", false)]
    [InlineData("FREQ=WEEKLY;BYDAY=TH;COUNT=3", false)]
    [InlineData("FREQ=WEEKLY;BYDAY=TH;COUNT=9", true)]
    [InlineData("FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2", true)]
    [InlineData("FREQ=SECONDLY", true)]
    public async Task A_series_that_began_before_today_comes_in_only_while_it_has_an_occurrence_today_or_later(string rule, bool imported)
    {
        // Thursdays from 1 October: the 9th is 26 November, today.
        rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Local("2026-10-01T19:00", CalendarRig.Zone), CalendarTime.Local("2026-10-01T21:00", CalendarRig.Zone), RRule: rule));

        var run = await rig.RunAsync();

        Assert.Equal(imported ? 1 : 0, run.TasksCreated);
    }

    [Fact]
    public async Task A_series_that_began_before_today_becomes_a_task_on_its_occurrence_from_today_and_the_series_stays()
    {
        // Thursdays from 1 October, twelve of them, 8 October left out: today, 26 November, is the ninth.
        rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Local("2026-10-01T19:00", CalendarRig.Zone), CalendarTime.Local("2026-10-01T21:00", CalendarRig.Zone),
            RRule: "FREQ=WEEKLY;BYDAY=TH;COUNT=12", ExDates: [CalendarTime.Local("2026-10-08T19:00", CalendarRig.Zone)]));

        await rig.RunAsync();
        var etags = rig.Fake.Events(rig.CalendarId).Select(each => each.Etag).ToList();
        var task = Assert.Single(await rig.TasksAsync());
        var again = await rig.RunAsync();

        Assert.Equal("2026-11-26T19:00", (string?)task["schedule"]!["start"]);
        Assert.Equal("2026-11-26T21:00", (string?)task["schedule"]!["end"]);
        // Twelve less the eight passed, the left-out one too, as completing counts them; no skips left.
        Assert.Contains("COUNT=4", (string?)task["recurrence"], StringComparison.Ordinal);
        Assert.DoesNotContain("X-PL-SKIP", (string?)task["recurrence"], StringComparison.Ordinal);
        // The task on a later occurrence reads as moved on: nothing is written to the series.
        Assert.Equal(0, again.EventsUpdated);
        Assert.Equal(etags, rig.Fake.Events(rig.CalendarId).Select(each => each.Etag));
    }

    [Theory]
    [InlineData("2026-10-01")]
    [InlineData("2026-10-01T19:00")]
    public async Task A_series_with_no_end_that_began_before_today_is_left_as_it_is(string start)
    {
        // QA F1 re-check: a task holds an end the event doesn't have (a day, or 30 minutes).
        var begins = start.Length == 10 ? CalendarTime.Date(start) : CalendarTime.Local(start, CalendarRig.Zone);
        rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", begins, null, RRule: "FREQ=WEEKLY"));

        await rig.RunAsync();
        var events = rig.Fake.Events(rig.CalendarId).Select(each => (each.Etag, each.Data.Start, each.Data.End)).ToList();
        var task = Assert.Single(await rig.TasksAsync());
        var again = await rig.RunAsync();

        Assert.StartsWith("2026-11-26", (string?)task["schedule"]!["start"], StringComparison.Ordinal);
        Assert.Equal(0, again.EventsUpdated);
        Assert.Equal(events, rig.Fake.Events(rig.CalendarId).Select(each => (each.Etag, each.Data.Start, each.Data.End)));
        Assert.Equal(begins, Assert.Single(rig.Fake.Events(rig.CalendarId)).Data.Start);
    }

    [Theory]
    [InlineData("2026-10-01", "title")]
    [InlineData("2026-10-01T19:00", "notes")]
    public async Task Editing_the_text_of_a_task_from_a_series_with_no_end_keeps_its_date(string start, string field)
    {
        // QA F4: the update gives the event an end; the next runs must not read that as a calendar edit.
        var begins = start.Length == 10 ? CalendarTime.Date(start) : CalendarTime.Local(start, CalendarRig.Zone);
        rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", begins, null, RRule: "FREQ=WEEKLY"));
        await rig.RunAsync();
        var id = (string)Assert.Single(await rig.TasksAsync())["id"]!;
        var schedule = (await rig.TaskAsync(id))!["schedule"]!.ToJsonString();

        await rig.EditTaskAsync(id, new JsonObject { [field] = "Choir, the new one" });
        var written = await rig.RunAsync();
        var again = await rig.RunAsync();
        var third = await rig.RunAsync();

        var task = (await rig.TaskAsync(id))!;
        Assert.Equal(schedule, task["schedule"]!.ToJsonString());
        Assert.Equal("Choir, the new one", (string?)task[field]);
        Assert.Equal(1, written.EventsUpdated);
        Assert.Equal(0, again.EventsUpdated + again.TasksChanged + third.EventsUpdated + third.TasksChanged);
        var series = Assert.Single(rig.Fake.Events(rig.CalendarId)).Data;
        Assert.Equal(begins, series.Start);
        Assert.Equal("FREQ=WEEKLY", series.RRule);
    }

    [Fact]
    public async Task A_task_with_a_status_or_tag_flag_of_the_wrong_kind_does_not_fail_the_run()
    {
        // Security N6: a shared task's writer can store any JSON in these fields.
        var odd = await rig.AddTaskAsync("Odd status", CalendarRig.Day("2026-12-02"));
        await rig.EditTaskAsync(odd, new JsonObject { ["status"] = 5 });
        var flag = await rig.AddTaskAsync("Odd flag", CalendarRig.Day("2026-12-03"));
        await rig.EditTaskAsync(flag, new JsonObject { ["tags"] = new JsonObject { [CalendarRig.Tag] = new JsonObject { ["in"] = "yes", ["hlc"] = rig.Clock.Next() } } });

        var run = await rig.RunAsync();

        Assert.Null(run.Problem);
        // A status that isn't text counts as open; a flag that isn't true leaves the task untagged.
        Assert.Equal(1, run.EventsCreated);
    }

    [Fact]
    public async Task Notes_with_carriage_returns_are_written_once_not_on_every_run()
    {
        // QA F6: a calendar keeps CR and CRLF as LF, and the snapshot is what it keeps.
        var id = await rig.AddTaskAsync("Packing", CalendarRig.Day("2026-12-02"));
        await rig.EditTaskAsync(id, new JsonObject { ["notes"] = "socks\r\nshirts\rshoes\u0007" });
        rig.Fake.Seed(rig.CalendarId, new EventData("Dentist", "", CalendarTime.Date("2026-12-04"), CalendarTime.Date("2026-12-05")));
        await rig.RunAsync();
        var dentist = (string)(await rig.TasksAsync()).Single(each => (string?)each["title"] == "Dentist")["id"]!;
        await rig.EditTaskAsync(dentist, new JsonObject { ["notes"] = "bring\r\nthe card" });

        var written = await rig.RunAsync();
        var again = await rig.RunAsync();
        var third = await rig.RunAsync();

        Assert.Equal(1, written.EventsUpdated);
        Assert.Equal(0, again.EventsUpdated + third.EventsUpdated);
        Assert.Contains(rig.Fake.Events(rig.CalendarId), each => each.Data.Description == "socks\nshirts\nshoes");
        Assert.Contains(rig.Fake.Events(rig.CalendarId), each => each.Data.Description == "bring\nthe card");
    }

    [Theory]
    [InlineData("time")]
    [InlineData("left out")]
    public async Task A_series_changed_on_the_calendar_keeps_its_task_on_the_occurrence_from_its_own_day(string change)
    {
        // QA F5: Thursdays from 1 October with an end; the task comes in on today's, 26 November.
        var seeded = rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Local("2026-10-01T19:00", CalendarRig.Zone), CalendarTime.Local("2026-10-01T21:00", CalendarRig.Zone), RRule: "FREQ=WEEKLY"));
        await rig.RunAsync();
        var id = (string)Assert.Single(await rig.TasksAsync())["id"]!;

        rig.Fake.Edit(rig.CalendarId, seeded.Id, data => change == "time"
            ? data with { Start = CalendarTime.Local("2026-10-01T18:00", CalendarRig.Zone), End = CalendarTime.Local("2026-10-01T20:00", CalendarRig.Zone) }
            : data with { ExDates = [CalendarTime.Local("2026-11-26T19:00", CalendarRig.Zone)] });
        await rig.RunAsync();
        var after = await rig.RunAsync();

        var schedule = (await rig.TaskAsync(id))!["schedule"]!;
        Assert.Equal(change == "time" ? "2026-11-26T18:00" : "2026-12-03T19:00", (string?)schedule["start"]);
        Assert.Equal(0, after.EventsUpdated + after.TasksChanged);
        Assert.Equal(change == "time" ? "2026-10-01T18:00" : "2026-10-01T19:00", Assert.Single(rig.Fake.Events(rig.CalendarId)).Data.Start.Value);
    }

    [Theory]
    [InlineData("FREQ=WEEKLY;UNTIL=20261120T235959Z")]
    [InlineData("FREQ=WEEKLY;COUNT=3")]
    public async Task A_series_cut_short_on_the_calendar_before_its_task_sends_the_task_to_Trash_and_is_left_alone_after(string rule)
    {
        // QA F7: "delete this and all following" removes the task's occurrence (26 November) and the rest.
        var seeded = rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Local("2026-10-01T19:00", CalendarRig.Zone), CalendarTime.Local("2026-10-01T21:00", CalendarRig.Zone), RRule: "FREQ=WEEKLY"));
        await rig.RunAsync();
        var id = (string)Assert.Single(await rig.TasksAsync())["id"]!;

        rig.Fake.Edit(rig.CalendarId, seeded.Id, data => data with { RRule = rule });
        var cut = await rig.RunAsync();

        Assert.Equal(1, cut.TasksTrashed);
        Assert.NotNull((await rig.TaskAsync(id))!["deletedAt"]);
        // QA F8: restored and moved earlier, or trashed for good, the task never reaches the series.
        var etag = rig.Fake.Event(rig.CalendarId, seeded.Id)!.Etag;
        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = null, ["schedule"] = CalendarRig.At("2026-11-19T19:00") });
        await rig.RunAsync();
        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = rig.Clock.Now() });
        await rig.RunAsync();

        // The restored task made an event of its own, gone again with it; the series is as the calendar left it.
        var series = Assert.Single(rig.Fake.Events(rig.CalendarId));
        Assert.Equal(seeded.Id, series.Id);
        Assert.Equal(etag, series.Etag);
        Assert.Equal(rule, series.Data.RRule);
    }

    [Theory]
    [InlineData("caldav")]
    [InlineData("google")]
    public async Task A_series_whose_task_is_in_Trash_is_never_deleted_when_the_link_restarts(string kind)
    {
        // Security N8: cut short on the calendar, its task goes to Trash and the series keeps our marker.
        // A restart (a new tag or mode) lists it afresh with no item: it must stay, with no write.
        Func<string> etag;
        Action cutShort;
        if (kind == "google")
        {
            await rig.UseGoogleAsync();
            var google = rig.GoogleService!;
            var id = (string)google.Seed(rig.GoogleAddress, rig.GoogleAddress, new JsonObject
            {
                ["summary"] = "Choir",
                ["start"] = new JsonObject { ["dateTime"] = "2026-10-01T19:00:00", ["timeZone"] = CalendarRig.Zone },
                ["end"] = new JsonObject { ["dateTime"] = "2026-10-01T21:00:00", ["timeZone"] = CalendarRig.Zone },
                ["recurrence"] = new JsonArray("RRULE:FREQ=WEEKLY"),
            })["id"]!;
            etag = () => (string)google.Event(rig.GoogleAddress, rig.GoogleAddress, id)!["etag"]!;
            cutShort = () => google.Edit(rig.GoogleAddress, rig.GoogleAddress, id, stored => stored["recurrence"] = new JsonArray("RRULE:FREQ=WEEKLY;UNTIL=20261120T235959Z"));
        }
        else
        {
            var seeded = rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Local("2026-10-01T19:00", CalendarRig.Zone), CalendarTime.Local("2026-10-01T21:00", CalendarRig.Zone), RRule: "FREQ=WEEKLY"));
            etag = () => rig.Fake.Event(rig.CalendarId, seeded.Id)!.Etag;
            cutShort = () => rig.Fake.Edit(rig.CalendarId, seeded.Id, data => data with { RRule = "FREQ=WEEKLY;UNTIL=20261120T235959Z" });
        }
        await rig.RunAsync();
        Assert.Single(await rig.TasksAsync());
        cutShort();
        Assert.Equal(1, (await rig.RunAsync()).TasksTrashed);
        var before = etag();

        // What the PUT route does on a new tag or mode: the link saved afresh, its items cleared.
        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        await rig.Calendars.SaveLinkAsync(link with { SyncToken = null }, Token);
        await rig.Calendars.ClearItemsAsync(rig.LinkId, Token);
        var restarted = await rig.RunAsync();
        var again = await rig.RunAsync();

        Assert.Equal(0, restarted.EventsDeleted + restarted.EventsUpdated + again.EventsDeleted + again.EventsUpdated);
        Assert.Equal(before, etag());
        Assert.Empty(await rig.TasksAsync());
        if (kind == "google") Assert.DoesNotContain(rig.GoogleService!.Calls, call => call.StartsWith("DELETE", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("off and on")]
    [InlineData("new tag")]
    public async Task Restarting_a_link_moves_and_deletes_nothing_on_the_calendar(string restart)
    {
        // QA F9, F10: a restart clears the link's items, and the events pair again by their markers alone.
        rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Local("2026-10-01T19:00", CalendarRig.Zone), null, RRule: "FREQ=WEEKLY"));
        rig.Fake.Seed(rig.CalendarId, new EventData("Mum's birthday", "", CalendarTime.Date("1960-01-05"), null, RRule: "FREQ=YEARLY"));
        rig.Fake.Seed(rig.CalendarId, new EventData("Car service", "", CalendarTime.Date("2026-12-03"), CalendarTime.Date("2026-12-04")));
        await rig.AddTaskAsync("Packing", CalendarRig.Day("2026-12-05"));
        await rig.RunAsync();
        // The tasks' dates written again, unchanged, so their side is the later one when they pair again.
        rig.Time.Advance(TimeSpan.FromMinutes(1));
        foreach (var task in await rig.TasksAsync())
        {
            await rig.EditTaskAsync((string)task["id"]!, new JsonObject { ["schedule"] = task["schedule"]!.DeepClone() });
        }
        await rig.RunAsync();
        var events = rig.Fake.Events(rig.CalendarId).Select(each => (each.Id, each.Etag)).OrderBy(each => each.Id, StringComparer.Ordinal).ToList();
        var schedules = (await rig.TasksAsync()).ToDictionary(each => (string)each["title"]!, each => each["schedule"]!.ToJsonString());
        Assert.Equal(4, events.Count);
        Assert.Equal(4, schedules.Count);

        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        if (restart == "new tag")
        {
            const string newTag = "01JDZKTAGNEW0000000000000N";
            await rig.WriteAsync("tags", rig.New(newTag, new JsonObject { ["name"] = "work", ["color"] = "#33AA66", ["order"] = "a1" }));
            link = link with { TagId = newTag };
        }
        await rig.Calendars.SaveLinkAsync(link with { SyncToken = null }, Token);
        await rig.Calendars.ClearItemsAsync(rig.LinkId, Token);
        var restarted = await rig.RunAsync();
        var again = await rig.RunAsync();

        Assert.Equal(0, restarted.EventsDeleted + restarted.EventsUpdated + again.EventsDeleted + again.EventsUpdated);
        Assert.Equal(events, rig.Fake.Events(rig.CalendarId).Select(each => (each.Id, each.Etag)).OrderBy(each => each.Id, StringComparer.Ordinal));
        Assert.Equal(schedules, (await rig.TasksAsync()).ToDictionary(each => (string)each["title"]!, each => each["schedule"]!.ToJsonString()));
    }

    [Fact]
    public async Task A_task_restored_after_its_series_was_cut_short_stays_restored_when_the_link_restarts()
    {
        // QA F11: the restored task has an event of its own, carrying the same marker as the old series.
        var seeded = rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Local("2026-10-01T19:00", CalendarRig.Zone), CalendarTime.Local("2026-10-01T21:00", CalendarRig.Zone), RRule: "FREQ=WEEKLY"));
        await rig.RunAsync();
        var id = (string)Assert.Single(await rig.TasksAsync())["id"]!;
        rig.Fake.Edit(rig.CalendarId, seeded.Id, data => data with { RRule = "FREQ=WEEKLY;UNTIL=20261120T235959Z" });
        await rig.RunAsync();
        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = null });
        Assert.Equal(1, (await rig.RunAsync()).EventsCreated);
        var events = rig.Fake.Events(rig.CalendarId).Select(each => (each.Id, each.Etag)).OrderBy(each => each.Id, StringComparer.Ordinal).ToList();
        Assert.Equal(2, events.Count);

        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        await rig.Calendars.SaveLinkAsync(link with { SyncToken = null }, Token);
        await rig.Calendars.ClearItemsAsync(rig.LinkId, Token);
        var restarted = await rig.RunAsync();
        var again = await rig.RunAsync();

        Assert.Null((await rig.TaskAsync(id))!["deletedAt"]);
        Assert.Equal(0, restarted.TasksTrashed + again.TasksTrashed + restarted.EventsDeleted + again.EventsDeleted);
        Assert.Equal(events, rig.Fake.Events(rig.CalendarId).Select(each => (each.Id, each.Etag)).OrderBy(each => each.Id, StringComparer.Ordinal));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task A_restored_task_moved_into_its_old_series_pairs_with_its_own_event_when_the_link_restarts(bool seriesFirst)
    {
        // QA F12: cut short on 20 November, the task restored and moved to the 19th, an occurrence of the
        // old series. After a restart both events carry its marker; whichever is listed first, only its
        // own event pairs, and a rename or delete never reaches the series.
        var seeded = rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Local("2026-10-01T19:00", CalendarRig.Zone), CalendarTime.Local("2026-10-01T21:00", CalendarRig.Zone), RRule: "FREQ=WEEKLY"));
        await rig.RunAsync();
        var id = (string)Assert.Single(await rig.TasksAsync())["id"]!;
        rig.Fake.Edit(rig.CalendarId, seeded.Id, data => data with { RRule = "FREQ=WEEKLY;UNTIL=20261120T235959Z" });
        Assert.Equal(1, (await rig.RunAsync()).TasksTrashed);
        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = null, ["schedule"] = CalendarRig.At("2026-11-19T19:00") });
        Assert.Equal(1, (await rig.RunAsync()).EventsCreated);
        var own = Assert.Single(rig.Fake.Events(rig.CalendarId), each => each.Id != seeded.Id).Id;
        var series = rig.Fake.Event(rig.CalendarId, seeded.Id)!.Etag;
        var schedule = (await rig.TaskAsync(id))!["schedule"]!.ToJsonString();
        rig.Fake.ListsInReverse = seriesFirst != string.CompareOrdinal(seeded.Id, own) < 0;

        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        await rig.Calendars.SaveLinkAsync(link with { SyncToken = null }, Token);
        await rig.Calendars.ClearItemsAsync(rig.LinkId, Token);
        var restarted = await rig.RunAsync();
        var again = await rig.RunAsync();

        Assert.Equal(0, restarted.EventsDeleted + restarted.EventsUpdated + again.EventsDeleted + again.EventsUpdated);
        Assert.Equal(schedule, (await rig.TaskAsync(id))!["schedule"]!.ToJsonString());
        Assert.Equal(series, rig.Fake.Event(rig.CalendarId, seeded.Id)!.Etag);

        await rig.EditTaskAsync(id, new JsonObject { ["title"] = "Choir, alto part" });
        Assert.Equal(1, (await rig.RunAsync()).EventsUpdated);
        Assert.Equal("Choir, alto part", rig.Fake.Event(rig.CalendarId, own)!.Data.Summary);
        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = rig.Clock.Now() });
        await rig.RunAsync();

        var left = Assert.Single(rig.Fake.Events(rig.CalendarId));
        Assert.Equal(seeded.Id, left.Id);
        Assert.Equal(series, left.Etag);
    }

    [Theory]
    [InlineData("ticked", true)]
    [InlineData("ticked", false)]
    [InlineData("moved", true)]
    [InlineData("moved", false)]
    public async Task A_restored_task_ticked_or_moved_gets_no_second_event_when_the_link_restarts(string change, bool seriesFirst)
    {
        // QA F13: the restored task's dates match neither event after a tick (which writes nothing) or a
        // move while the calendar was off. It pairs with its own event, never gets another, and never the old series.
        var seeded = rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Local("2026-10-01T19:00", CalendarRig.Zone), CalendarTime.Local("2026-10-01T21:00", CalendarRig.Zone), RRule: "FREQ=WEEKLY"));
        await rig.RunAsync();
        var id = (string)Assert.Single(await rig.TasksAsync())["id"]!;
        rig.Fake.Edit(rig.CalendarId, seeded.Id, data => data with { RRule = "FREQ=WEEKLY;UNTIL=20261120T235959Z" });
        Assert.Equal(1, (await rig.RunAsync()).TasksTrashed);
        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = null, ["schedule"] = CalendarRig.At("2026-11-19T19:00") });
        Assert.Equal(1, (await rig.RunAsync()).EventsCreated);
        var own = Assert.Single(rig.Fake.Events(rig.CalendarId), each => each.Id != seeded.Id).Id;
        Assert.NotNull(rig.Fake.Event(rig.CalendarId, own)!.Data.RRule);
        var events = rig.Fake.Events(rig.CalendarId).Select(each => (each.Id, each.Etag)).OrderBy(each => each.Id, StringComparer.Ordinal).ToList();

        // Ticked: on to its own series' next week. Moved: to a Tuesday, no occurrence of either, while off.
        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        var moved = (JsonObject)(await rig.TaskAsync(id))!["schedule"]!.DeepClone();
        moved["start"] = change == "ticked" ? "2026-11-26T19:00" : "2026-12-08T19:00";
        if (change == "ticked") await rig.EditTaskAsync(id, new JsonObject { ["schedule"] = moved.DeepClone() });
        if (change == "ticked") Assert.Equal(0, (await rig.RunAsync()).EventsUpdated);
        rig.Fake.ListsInReverse = seriesFirst != string.CompareOrdinal(seeded.Id, own) < 0;
        await rig.Calendars.SaveLinkAsync(link with { SyncToken = null }, Token);
        await rig.Calendars.ClearItemsAsync(rig.LinkId, Token);
        if (change == "moved") await rig.EditTaskAsync(id, new JsonObject { ["schedule"] = moved.DeepClone() });
        var restarted = await rig.RunAsync();
        var again = await rig.RunAsync();

        Assert.Equal(0, restarted.EventsCreated + restarted.EventsDeleted + restarted.EventsUpdated + again.EventsCreated + again.EventsDeleted + again.EventsUpdated);
        Assert.Equal(events, rig.Fake.Events(rig.CalendarId).Select(each => (each.Id, each.Etag)).OrderBy(each => each.Id, StringComparer.Ordinal));
        // Ticked, it keeps its week; moved while off, it takes its own series' next date (the calendar's dates win).
        Assert.Equal(change == "ticked" ? "2026-11-26T19:00" : "2026-12-10T19:00", (string?)(await rig.TaskAsync(id))!["schedule"]!["start"]);

        await rig.EditTaskAsync(id, new JsonObject { ["title"] = "Choir, alto part" });
        var renamed = await rig.RunAsync();
        Assert.Equal(1, renamed.EventsUpdated);
        Assert.Equal(0, renamed.EventsCreated);
        Assert.Equal(2, rig.Fake.Events(rig.CalendarId).Count);
        Assert.Equal("Choir, alto part", rig.Fake.Event(rig.CalendarId, own)!.Data.Summary);
        Assert.Equal(events.Single(each => each.Id == seeded.Id).Etag, rig.Fake.Event(rig.CalendarId, seeded.Id)!.Etag);
    }

    [Theory]
    [InlineData("before, ticked", true)]
    [InlineData("before, ticked", false)]
    [InlineData("before, moved while off", true)]
    [InlineData("before, moved while off", false)]
    [InlineData("first date, ticked", true)]
    [InlineData("first date, ticked", false)]
    public async Task A_restored_task_moved_back_never_pairs_with_its_old_series_when_the_link_restarts(string shape, bool seriesFirst)
    {
        // QA F14: Thursdays from 1 October, cut to 20 November; the task restored and moved back to
        // 24 September (before the series) or to 1 October (its first date). After a restart the old
        // series starts as late or later than the task's own event: deleting the task must leave it.
        var seeded = rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Local("2026-10-01T19:00", CalendarRig.Zone), CalendarTime.Local("2026-10-01T21:00", CalendarRig.Zone), RRule: "FREQ=WEEKLY"));
        await rig.RunAsync();
        var id = (string)Assert.Single(await rig.TasksAsync())["id"]!;
        rig.Fake.Edit(rig.CalendarId, seeded.Id, data => data with { RRule = "FREQ=WEEKLY;UNTIL=20261120T235959Z" });
        Assert.Equal(1, (await rig.RunAsync()).TasksTrashed);
        var schedule = CalendarRig.At(shape.StartsWith("before", StringComparison.Ordinal) ? "2026-09-24T19:00" : "2026-10-01T19:00");
        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = null, ["schedule"] = schedule.DeepClone() });
        Assert.Equal(1, (await rig.RunAsync()).EventsCreated);
        var own = Assert.Single(rig.Fake.Events(rig.CalendarId), each => each.Id != seeded.Id).Id;
        if (shape.EndsWith("ticked", StringComparison.Ordinal))
        {
            schedule["start"] = shape.StartsWith("before", StringComparison.Ordinal) ? "2026-10-01T19:00" : "2026-10-08T19:00";
            await rig.EditTaskAsync(id, new JsonObject { ["schedule"] = schedule.DeepClone() });
            Assert.Equal(0, (await rig.RunAsync()).EventsUpdated);
        }
        var series = rig.Fake.Event(rig.CalendarId, seeded.Id)!.Etag;
        rig.Fake.ListsInReverse = seriesFirst != string.CompareOrdinal(seeded.Id, own) < 0;
        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        await rig.Calendars.SaveLinkAsync(link with { SyncToken = null }, Token);
        await rig.Calendars.ClearItemsAsync(rig.LinkId, Token);
        if (shape.EndsWith("off", StringComparison.Ordinal))
        {
            schedule["start"] = "2026-10-15T19:00";
            await rig.EditTaskAsync(id, new JsonObject { ["schedule"] = schedule.DeepClone() });
        }
        var restarted = await rig.RunAsync();
        await rig.EditTaskAsync(id, new JsonObject { ["title"] = "Choir, alto part" });
        var renamed = await rig.RunAsync();

        Assert.Equal(0, restarted.EventsCreated + restarted.EventsDeleted + restarted.EventsUpdated + renamed.EventsCreated + renamed.EventsDeleted);
        Assert.Equal("Choir, alto part", rig.Fake.Event(rig.CalendarId, own)!.Data.Summary);
        Assert.Equal(series, rig.Fake.Event(rig.CalendarId, seeded.Id)!.Etag);

        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = rig.Clock.Now() });
        await rig.RunAsync();
        var left = Assert.Single(rig.Fake.Events(rig.CalendarId));
        Assert.Equal(seeded.Id, left.Id);
        Assert.Equal(series, left.Etag);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task A_restored_task_that_ticks_into_its_count_cut_series_never_pairs_with_it(bool seriesFirst)
    {
        // QA F15: Thursdays from 1 October, 16 times; the task comes in with 8 left, the series is cut
        // to 7. Restored, moved to 24 September and ticked, the task is 1 October with 7 left: the old
        // series exactly. After a restart neither event is surely its own, so neither pairs.
        var seeded = rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Local("2026-10-01T19:00", CalendarRig.Zone), CalendarTime.Local("2026-10-01T21:00", CalendarRig.Zone), RRule: "FREQ=WEEKLY;COUNT=16"));
        await rig.RunAsync();
        var id = (string)Assert.Single(await rig.TasksAsync())["id"]!;
        var rule = (string)(await rig.TaskAsync(id))!["recurrence"]!;
        Assert.Contains("COUNT=8", rule, StringComparison.Ordinal);
        rig.Fake.Edit(rig.CalendarId, seeded.Id, data => data with { RRule = "FREQ=WEEKLY;COUNT=7" });
        Assert.Equal(1, (await rig.RunAsync()).TasksTrashed);
        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = null, ["schedule"] = CalendarRig.At("2026-09-24T19:00", "2026-09-24T21:00") });
        Assert.Equal(1, (await rig.RunAsync()).EventsCreated);
        var own = Assert.Single(rig.Fake.Events(rig.CalendarId), each => each.Id != seeded.Id).Id;
        await rig.EditTaskAsync(id, new JsonObject { ["schedule"] = CalendarRig.At("2026-10-01T19:00", "2026-10-01T21:00"), ["recurrence"] = rule.Replace("COUNT=8", "COUNT=7", StringComparison.Ordinal) });
        Assert.Equal(0, (await rig.RunAsync()).EventsUpdated);
        var events = rig.Fake.Events(rig.CalendarId).Select(each => (each.Id, each.Etag)).OrderBy(each => each.Id, StringComparer.Ordinal).ToList();

        rig.Fake.ListsInReverse = seriesFirst != string.CompareOrdinal(seeded.Id, own) < 0;
        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        await rig.Calendars.SaveLinkAsync(link with { SyncToken = null }, Token);
        await rig.Calendars.ClearItemsAsync(rig.LinkId, Token);
        var restarted = await rig.RunAsync();
        await rig.EditTaskAsync(id, new JsonObject { ["title"] = "Choir, alto part", ["notes"] = "bring the score" });
        var edited = await rig.RunAsync();
        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = rig.Clock.Now() });
        var trashed = await rig.RunAsync();

        Assert.Equal(0, restarted.EventsCreated + restarted.EventsDeleted + restarted.EventsUpdated);
        Assert.Equal(0, edited.EventsCreated + edited.EventsDeleted + edited.EventsUpdated);
        Assert.Equal(0, trashed.EventsCreated + trashed.EventsDeleted + trashed.EventsUpdated);
        Assert.Equal(events, rig.Fake.Events(rig.CalendarId).Select(each => (each.Id, each.Etag)).OrderBy(each => each.Id, StringComparer.Ordinal));
    }

    [Theory]
    [InlineData(10, "2026-10-29", "2026-11-12")]
    [InlineData(20, "2026-07-02", "2026-10-15")]
    public async Task A_restored_counted_task_moved_past_its_own_event_while_off_never_pairs_with_its_old_series(int count, string restoredTo, string movedTo)
    {
        // QA F16: Thursdays from 1 October, cut to 8 on the calendar. The task, restored and moved, gets
        // its own counted event; moved on while the calendar is off, that event ends before the task's
        // day, and the old series alone is still running. Neither pairs: the old series is left alone.
        var seeded = rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Local("2026-10-01T19:00", CalendarRig.Zone), CalendarTime.Local("2026-10-01T21:00", CalendarRig.Zone), RRule: $"FREQ=WEEKLY;COUNT={count}"));
        await rig.RunAsync();
        var id = (string)Assert.Single(await rig.TasksAsync())["id"]!;
        rig.Fake.Edit(rig.CalendarId, seeded.Id, data => data with { RRule = "FREQ=WEEKLY;COUNT=8" });
        Assert.Equal(1, (await rig.RunAsync()).TasksTrashed);
        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = null, ["schedule"] = CalendarRig.At($"{restoredTo}T19:00", $"{restoredTo}T21:00") });
        Assert.Equal(1, (await rig.RunAsync()).EventsCreated);
        var events = rig.Fake.Events(rig.CalendarId).Select(each => (each.Id, each.Etag)).OrderBy(each => each.Id, StringComparer.Ordinal).ToList();
        Assert.Equal(2, events.Count);

        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        await rig.Calendars.SaveLinkAsync(link with { SyncToken = null }, Token);
        await rig.Calendars.ClearItemsAsync(rig.LinkId, Token);
        await rig.EditTaskAsync(id, new JsonObject { ["schedule"] = CalendarRig.At($"{movedTo}T19:00", $"{movedTo}T21:00") });
        var restarted = await rig.RunAsync();
        await rig.EditTaskAsync(id, new JsonObject { ["title"] = "Choir, alto part" });
        var edited = await rig.RunAsync();
        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = rig.Clock.Now() });
        var trashed = await rig.RunAsync();

        Assert.Equal(0, restarted.EventsCreated + restarted.EventsDeleted + restarted.EventsUpdated);
        Assert.Equal(0, edited.EventsCreated + edited.EventsDeleted + edited.EventsUpdated);
        Assert.Equal(0, trashed.EventsCreated + trashed.EventsDeleted + trashed.EventsUpdated);
        Assert.Equal(events, rig.Fake.Events(rig.CalendarId).Select(each => (each.Id, each.Etag)).OrderBy(each => each.Id, StringComparer.Ordinal));
    }

    [Fact]
    public async Task A_restored_task_whose_own_event_cant_be_told_apart_gets_no_new_event_then_or_later()
    {
        // QA F14: its repeat changed while the calendar was off, so neither event with its marker is
        // surely its own. Neither pairs, and neither a restart nor a later edit makes a third.
        var seeded = rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Local("2026-10-01T19:00", CalendarRig.Zone), CalendarTime.Local("2026-10-01T21:00", CalendarRig.Zone), RRule: "FREQ=WEEKLY"));
        await rig.RunAsync();
        var id = (string)Assert.Single(await rig.TasksAsync())["id"]!;
        rig.Fake.Edit(rig.CalendarId, seeded.Id, data => data with { RRule = "FREQ=WEEKLY;UNTIL=20261120T235959Z" });
        await rig.RunAsync();
        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = null, ["schedule"] = CalendarRig.At("2026-11-19T19:00") });
        Assert.Equal(1, (await rig.RunAsync()).EventsCreated);
        var events = rig.Fake.Events(rig.CalendarId).Select(each => (each.Id, each.Etag)).OrderBy(each => each.Id, StringComparer.Ordinal).ToList();

        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        await rig.Calendars.SaveLinkAsync(link with { SyncToken = null }, Token);
        await rig.Calendars.ClearItemsAsync(rig.LinkId, Token);
        await rig.EditTaskAsync(id, new JsonObject { ["recurrence"] = "FREQ=DAILY", ["schedule"] = CalendarRig.At("2026-12-01T19:00") });
        var restarted = await rig.RunAsync();
        await rig.EditTaskAsync(id, new JsonObject { ["title"] = "Choir, alto part" });
        var edited = await rig.RunAsync();
        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = rig.Clock.Now() });
        var trashed = await rig.RunAsync();

        Assert.Equal(0, restarted.EventsCreated + restarted.EventsDeleted + restarted.EventsUpdated);
        Assert.Equal(0, edited.EventsCreated + edited.EventsDeleted + edited.EventsUpdated);
        Assert.Equal(0, trashed.EventsCreated + trashed.EventsDeleted + trashed.EventsUpdated);
        Assert.Equal(events, rig.Fake.Events(rig.CalendarId).Select(each => (each.Id, each.Etag)).OrderBy(each => each.Id, StringComparer.Ordinal));
    }

    [Fact]
    public async Task Ticking_a_task_from_a_series_with_no_end_writes_nothing_to_the_calendar()
    {
        // Thursdays from 3 December, no end, as QA's: imported as it is, then ticked once.
        rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Date("2026-12-03"), null, RRule: "FREQ=WEEKLY"));
        await rig.RunAsync();
        var events = rig.Fake.Events(rig.CalendarId).Select(each => each.Etag).ToList();
        var task = Assert.Single(await rig.TasksAsync());
        var id = (string)task["id"]!;

        // What ticking does (RepeatingTask.Complete): the task moves on a week, and a closed copy stays in history.
        var moved = (JsonObject)task["schedule"]!.DeepClone();
        moved["start"] = "2026-12-10";
        await rig.EditTaskAsync(id, new JsonObject { ["schedule"] = moved });
        var copy = await rig.AddTaskAsync("Choir", CalendarRig.Day("2026-12-03"));
        await rig.EditTaskAsync(copy, new JsonObject { ["status"] = "done", ["completedAt"] = "2026-11-26T10:00:00.000Z" });
        var run = await rig.RunAsync();

        Assert.Equal(0, run.EventsUpdated);
        Assert.Equal(0, run.EventsCreated);
        Assert.Equal(events, rig.Fake.Events(rig.CalendarId).Select(each => each.Etag));
    }

    [Fact]
    public async Task A_yearly_event_from_long_ago_becomes_a_task_on_its_next_date()
    {
        rig.Fake.Seed(rig.CalendarId, new EventData("Mum's birthday", "", CalendarTime.Date("1960-01-05"), CalendarTime.Date("1960-01-06"), RRule: "FREQ=YEARLY"));

        await rig.RunAsync();

        var task = Assert.Single(await rig.TasksAsync());
        Assert.Equal("2027-01-05", (string?)task["schedule"]!["start"]);
        Assert.Equal(0, (await rig.RunAsync()).EventsUpdated);
    }

    [Fact]
    public async Task A_series_whose_last_occurrences_are_left_out_has_none_today_or_later()
    {
        rig.Fake.Seed(rig.CalendarId, new EventData("Choir", "", CalendarTime.Date("2026-11-12"), CalendarTime.Date("2026-11-13"), RRule: "FREQ=WEEKLY;COUNT=3",
            ExDates: [CalendarTime.Date("2026-11-26")]));

        Assert.Equal(0, (await rig.RunAsync()).TasksCreated);
    }

    [Fact]
    public async Task Events_the_person_doesnt_own_never_become_tasks()
    {
        var invite = rig.Fake.Seed(rig.CalendarId, new EventData("Kim's party", "", CalendarTime.Date("2026-12-05"), CalendarTime.Date("2026-12-06")), foreign: true);
        rig.Fake.Seed(rig.CalendarId, new EventData("Mine", "", CalendarTime.Date("2026-12-05"), CalendarTime.Date("2026-12-06")));

        var run = await rig.RunAsync();

        Assert.Equal(1, run.TasksCreated);
        Assert.Equal(invite.Etag, rig.Fake.Event(rig.CalendarId, invite.Id)!.Etag);
        Assert.Null(rig.Fake.Event(rig.CalendarId, invite.Id)!.Data.Marker);
    }

    [Fact]
    public async Task A_past_event_moved_to_next_week_comes_in_on_the_run_after()
    {
        var moved = rig.Fake.Seed(rig.CalendarId, new EventData("Dentist", "", CalendarTime.Date("2026-11-20"), CalendarTime.Date("2026-11-21")));
        Assert.Equal(0, (await rig.RunAsync()).TasksCreated);

        rig.Fake.Edit(rig.CalendarId, moved.Id, data => data with { Start = CalendarTime.Date("2026-12-03"), End = CalendarTime.Date("2026-12-04") });
        var run = await rig.RunAsync();

        Assert.Equal(1, run.TasksCreated);
        var task = Assert.Single(await rig.TasksAsync());
        Assert.Equal((string)task["id"]!, rig.Fake.Event(rig.CalendarId, moved.Id)!.Data.Marker?.TaskId);
    }

    [Fact]
    public async Task A_stray_marker_on_a_past_event_is_left_alone()
    {
        var instance = await rig.Instance.GetAsync(Token);
        var stray = rig.Fake.Seed(rig.CalendarId, new EventData("Old lunch", "", CalendarTime.Date("2026-11-02"), CalendarTime.Date("2026-11-03"),
            Marker: new EventMarker(instance, "01JDZKNEVERWRITTEN00000000")));

        var run = await rig.RunAsync();

        Assert.Equal(0, run.TasksCreated);
        Assert.Equal(stray.Etag, rig.Fake.Event(rig.CalendarId, stray.Id)!.Etag);
        Assert.Empty(await rig.TasksAsync());
    }

    [Fact]
    public async Task Tasks_go_to_the_calendar_whatever_their_date()
    {
        await rig.AddTaskAsync("Last month", CalendarRig.Day("2026-10-14"));

        var run = await rig.RunAsync();

        Assert.Equal(1, run.EventsCreated);
        Assert.Equal("Last month", OnlyEvent().Data.Summary);
    }

    [Fact]
    public async Task Through_the_real_Google_adapter_only_the_persons_own_upcoming_events_come_in_as_the_preview_said()
    {
        await rig.UseGoogleAsync();
        var google = rig.GoogleService!;
        JsonObject Event(string summary, string date) => new()
        {
            ["summary"] = summary,
            ["start"] = new JsonObject { ["date"] = date },
            ["end"] = new JsonObject { ["date"] = date[..8] + (int.Parse(date[8..], System.Globalization.CultureInfo.InvariantCulture) + 1).ToString("00", System.Globalization.CultureInfo.InvariantCulture) },
        };
        google.Seed(rig.GoogleAddress, rig.GoogleAddress, Event("Mine", "2026-12-03"));
        google.Seed(rig.GoogleAddress, rig.GoogleAddress, Event("Mine, last month", "2026-10-03"));
        var invite = Event("Kim's party", "2026-12-04");
        invite["organizer"] = new JsonObject { ["email"] = "kim@example.com" };
        google.Seed(rig.GoogleAddress, rig.GoogleAddress, invite);
        foreach (var kind in new[] { "birthday", "outOfOffice", "focusTime", "workingLocation", "fromGmail" })
        {
            var kept = Event(kind, "2026-12-05");
            kept["eventType"] = kind;
            google.Seed(rig.GoogleAddress, rig.GoogleAddress, kept);
        }
        var preview = await rig.Engine.ImportCountAsync((await rig.Calendars.LinkAsync(rig.LinkId, Token))!, Token);

        var run = await rig.RunAsync();

        Assert.Equal(1, preview);
        Assert.Equal(1, run.TasksCreated);
        Assert.Equal(["Mine"], (await rig.TasksAsync()).Select(task => (string)task["title"]!));
        Assert.Single(google.Patches);
    }

    [Fact]
    public async Task The_import_preview_counts_what_a_run_then_imports_and_writes_nothing()
    {
        var instance = await rig.Instance.GetAsync(Token);
        var paired = await rig.AddTaskAsync("Paired", CalendarRig.Day("2026-12-09"), tagged: false);
        rig.Fake.Seed(rig.CalendarId, new EventData("Past", "", CalendarTime.Date("2026-11-20"), CalendarTime.Date("2026-11-21")));
        rig.Fake.Seed(rig.CalendarId, new EventData("Future", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")));
        rig.Fake.Seed(rig.CalendarId, new EventData("Weekly", "", CalendarTime.Date("2026-10-01"), CalendarTime.Date("2026-10-02"), RRule: "FREQ=WEEKLY"));
        rig.Fake.Seed(rig.CalendarId, new EventData("Invite", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")), foreign: true);
        rig.Fake.Seed(rig.CalendarId, new EventData("Stray", "", CalendarTime.Date("2026-12-04"), CalendarTime.Date("2026-12-05"), Marker: new EventMarker(instance, "01JDZKNEVERWRITTEN00000000")));
        rig.Fake.Seed(rig.CalendarId, new EventData("Other server", "", CalendarTime.Date("2026-12-04"), CalendarTime.Date("2026-12-05"), Marker: new EventMarker("01JDZKOTHERSERVER000000000", "01JDZKOTHERTASK00000000000")));
        rig.Fake.Seed(rig.CalendarId, new EventData("Paired", "", CalendarTime.Date("2026-12-09"), CalendarTime.Date("2026-12-10"), Marker: new EventMarker(instance, paired)));
        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        var etags = rig.Fake.Events(rig.CalendarId).Select(each => each.Etag).ToList();

        var counted = await rig.Engine.ImportCountAsync(link with { Mode = CalendarModes.Show }, Token);

        Assert.Equal(etags, rig.Fake.Events(rig.CalendarId).Select(each => each.Etag));
        Assert.Empty(await rig.Calendars.ItemsAsync(rig.LinkId, Token));
        Assert.Equal(3, counted);
        var run = await rig.RunAsync();
        Assert.Equal(counted, run.TasksCreated);
    }

    [Fact]
    public async Task A_preview_whose_deadline_passes_once_the_listing_is_in_stops_without_counting()
    {
        rig.Fake.Seed(rig.CalendarId, new EventData("Future", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")));
        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        Assert.Equal(1, await rig.Engine.ImportCountAsync(link, Token));
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(Token);
        rig.Fake.AfterListing = deadline.Cancel;

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => rig.Engine.ImportCountAsync(link, deadline.Token));
    }

    [Fact]
    public async Task A_run_whose_deadline_passes_once_the_listing_is_in_makes_no_tasks()
    {
        rig.Fake.Seed(rig.CalendarId, new EventData("Future", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")));
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(Token);
        rig.Fake.AfterListing = deadline.Cancel;

        try
        {
            await rig.Engine.SyncLinkAsync(rig.LinkId, deadline.Token);
        }
        catch (OperationCanceledException)
        {
            // Stopped where the deadline found it: either way, nothing came in.
        }

        Assert.Empty(await rig.TasksAsync());
    }

    /// <summary>Events a task can't hold exactly: an end in another zone, a rule worded otherwise or with parts a task drops, no length, no zone.</summary>
    private static IEnumerable<EventData> EventsATaskCantHoldExactly() =>
    [
        new("Flight", "", CalendarTime.Local("2026-12-04T09:00", "America/Chicago"), CalendarTime.Local("2026-12-04T13:30", "America/New_York")),
        new("Book club", "", CalendarTime.Local("2026-12-02T19:00", CalendarRig.Zone), CalendarTime.Local("2026-12-02T20:00", CalendarRig.Zone), RRule: "INTERVAL=2;FREQ=WEEKLY;BYDAY=WE;WKST=SU"),
        new("Board meeting", "", CalendarTime.Local("2026-12-08T18:00", CalendarRig.Zone), CalendarTime.Local("2026-12-08T19:00", CalendarRig.Zone), RRule: "FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2"),
        new("Reminder", "", CalendarTime.Local("2026-12-05T08:00", CalendarRig.Zone), CalendarTime.Local("2026-12-05T08:00", CalendarRig.Zone)),
        new("Call", "", CalendarTime.Local("2026-12-06T10:00", null), CalendarTime.Local("2026-12-06T10:30", null)),
    ];

    [Fact]
    public async Task Events_a_task_cant_hold_exactly_get_only_their_marker_and_are_not_written_again_while_nothing_changes()
    {
        var seeded = EventsATaskCantHoldExactly().Select(data => rig.Fake.Seed(rig.CalendarId, data)).ToList();

        var first = await rig.RunAsync();

        Assert.Equal(seeded.Count, first.TasksCreated);
        foreach (var each in seeded)
        {
            var marked = rig.Fake.Event(rig.CalendarId, each.Id)!;
            Assert.NotNull(marked.Data.Marker);
            Assert.True(CalendarJson.Same(each.Data, marked.Data with { Marker = null }), each.Data.Summary);
        }
        var etags = seeded.ToDictionary(each => each.Id, each => rig.Fake.Event(rig.CalendarId, each.Id)!.Etag);

        // The run after reads the tasks back as unchanged, and so does a full listing.
        Assert.Equal(new CalendarRun(), await rig.RunAsync());
        await rig.Calendars.SaveLinkAsync((await rig.Calendars.LinkAsync(rig.LinkId, Token))! with { SyncToken = null }, Token);
        Assert.Equal(new CalendarRun(), await rig.RunAsync());

        Assert.All(seeded, each => Assert.Equal(etags[each.Id], rig.Fake.Event(rig.CalendarId, each.Id)!.Etag));
    }

    [Fact]
    public async Task An_edited_title_on_a_task_made_from_such_an_event_writes_the_title_and_leaves_its_times()
    {
        var flight = rig.Fake.Seed(rig.CalendarId, EventsATaskCantHoldExactly().First());
        await rig.RunAsync();
        var task = Assert.Single(await rig.TasksAsync());

        await rig.EditTaskAsync((string)task["id"]!, new JsonObject { ["title"] = "Flight home" });
        var run = await rig.RunAsync();

        Assert.Equal(1, run.EventsUpdated);
        var stored = rig.Fake.Event(rig.CalendarId, flight.Id)!.Data;
        Assert.Equal("Flight home", stored.Summary);
        Assert.True(CalendarJson.SameWhen(flight.Data, stored));
    }

    [Fact]
    public async Task Google_events_get_their_marker_alone_and_unchanged_pairs_send_nothing_through_the_real_adapter()
    {
        await rig.UseGoogleAsync();
        var google = rig.GoogleService!;
        google.Seed(rig.GoogleAddress, rig.GoogleAddress, new JsonObject
        {
            ["summary"] = "Flight",
            ["description"] = "<b>Gate</b> B12",
            ["start"] = new JsonObject { ["dateTime"] = "2026-12-04T09:00:00-06:00", ["timeZone"] = "America/Chicago" },
            ["end"] = new JsonObject { ["dateTime"] = "2026-12-04T13:30:00-05:00", ["timeZone"] = "America/New_York" },
        });
        google.Seed(rig.GoogleAddress, rig.GoogleAddress, new JsonObject
        {
            ["summary"] = "Book club",
            ["start"] = new JsonObject { ["dateTime"] = "2026-12-02T19:00:00Z" },
            ["end"] = new JsonObject { ["dateTime"] = "2026-12-02T20:00:00Z" },
            ["recurrence"] = new JsonArray("RRULE:INTERVAL=2;FREQ=WEEKLY;BYDAY=WE;WKST=SU", "EXDATE;TZID=America/Chicago:20261216T130000"),
        });

        var first = await rig.RunAsync();

        Assert.Equal(2, first.TasksCreated);
        Assert.Equal(2, google.Patches.Count);
        Assert.All(google.Patches, patch => Assert.Equal(["extendedProperties"], patch.Body.Select(pair => pair.Key)));

        Assert.Equal(new CalendarRun(), await rig.RunAsync());
        await rig.Calendars.SaveLinkAsync((await rig.Calendars.LinkAsync(rig.LinkId, Token))! with { SyncToken = null }, Token);
        Assert.Equal(new CalendarRun(), await rig.RunAsync());
        Assert.Equal(2, google.Patches.Count);
    }

    /// <summary>A run of the link held at its listing, the account disconnected meanwhile, then the listing answering (or failing).</summary>
    private async Task<CalendarRun> DisconnectedDuringARunAsync(Exception? listingFails)
    {
        await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-12-07"));
        rig.Fake.Seed(rig.CalendarId, new EventData("Lunch", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")));
        var accountId = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!.CalendarAccountId;
        // As after a refused sign-in: the run that recovers writes the account back to well.
        await rig.Calendars.SaveAccountAsync((await rig.Calendars.AccountAsync(accountId, Token))! with { Problem = "calendar_unavailable" }, Token);
        var release = rig.Fake.Hold(rig.CalendarId);
        var running = rig.RunAsync();
        await rig.Fake.Held.Task.WaitAsync(Token);

        await rig.Calendars.DeleteAccountAsync(accountId, Token);
        if (listingFails is null) release.SetResult();
        else release.SetException(listingFails);
        var run = await running;

        Assert.Null(await rig.Calendars.AccountAsync(accountId, Token));
        Assert.Null(await rig.Calendars.LinkAsync(rig.LinkId, Token));
        Assert.Empty(await rig.Calendars.ItemsAsync(rig.LinkId, Token));
        return run;
    }

    [Fact]
    public async Task A_run_that_outlives_a_disconnect_writes_back_no_account_link_or_items()
    {
        var run = await DisconnectedDuringARunAsync(listingFails: null);

        Assert.Null(run.Problem);
    }

    [Fact]
    public async Task A_run_whose_sign_in_fails_after_a_disconnect_does_not_bring_the_account_back()
    {
        var run = await DisconnectedDuringARunAsync(new CalendarProblem(CalendarProblemKind.Auth, "calendar_auth_failed", "the token was revoked"));

        Assert.Equal("calendar_auth_failed", run.Problem);
    }

    [Fact]
    public async Task A_run_cut_short_after_a_disconnect_salvages_nothing_into_the_store()
    {
        var alpha = rig.Fake.Seed(rig.CalendarId, new EventData("Alpha", "", CalendarTime.Date("2026-12-01"), CalendarTime.Date("2026-12-02")));
        var bravo = rig.Fake.Seed(rig.CalendarId, new EventData("Bravo", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")));
        // Listed in id order: the first is marked, then the service stops answering, so the run salvages.
        rig.Fake.HangWrites(new[] { alpha.Id, bravo.Id }.Max(StringComparer.Ordinal)!);
        var accountId = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!.CalendarAccountId;
        var release = rig.Fake.Hold(rig.CalendarId);
        var running = rig.NewEngine(deadline: TimeSpan.FromSeconds(2)).SyncLinkAsync(rig.LinkId, Token);
        await rig.Fake.Held.Task.WaitAsync(Token);

        await rig.Calendars.DeleteAccountAsync(accountId, Token);
        release.SetResult();
        var cut = await running;

        Assert.Equal(CalendarSync.TimedOut, cut.Problem);
        Assert.Null(await rig.Calendars.AccountAsync(accountId, Token));
        Assert.Null(await rig.Calendars.LinkAsync(rig.LinkId, Token));
        Assert.Empty(await rig.Calendars.ItemsAsync(rig.LinkId, Token));
    }

    [Fact]
    public async Task A_run_of_a_use_changed_meanwhile_keeps_neither_its_token_nor_its_items()
    {
        rig.Fake.Seed(rig.CalendarId, new EventData("Lunch", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")));
        var release = rig.Fake.Hold(rig.CalendarId);
        var running = rig.RunAsync();
        await rig.Fake.Held.Task.WaitAsync(Token);

        // The person changes the calendar to show events, as the PUT route does it: the new use, then the items cleared.
        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        await rig.Calendars.SaveLinkAsync(link with { Mode = CalendarModes.Show, TagId = null, SyncToken = null, TaskCursor = 0, SyncedAt = null }, Token);
        await rig.Calendars.ClearItemsAsync(rig.LinkId, Token);
        release.SetResult();
        await running;

        var after = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        Assert.Equal(CalendarModes.Show, after.Mode);
        Assert.Null(after.SyncToken);
        Assert.Null(after.SyncedAt);
        Assert.Empty(await rig.Calendars.ItemsAsync(rig.LinkId, Token));
    }

    [Fact]
    public async Task An_event_the_calendar_wont_change_or_delete_is_let_go_and_not_asked_again()
    {
        var id = await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-12-07"));
        await rig.RunAsync();
        var made = OnlyEvent();
        rig.Fake.RefuseWrites(made.Id, new CalendarProblem(CalendarProblemKind.Refused, "calendar_forbidden", "Google answered 403 (forbiddenForNonOrganizer)"));

        await rig.EditTaskAsync(id, new JsonObject { ["title"] = "Dentist (moved)" });
        var changing = await rig.RunAsync();

        Assert.Null(changing.Problem);
        Assert.Equal(1, changing.EventsRefused);
        Assert.Equal("Dentist", OnlyEvent().Data.Summary);
        Assert.Null((await rig.Calendars.ItemsAsync(rig.LinkId, Token)).Single().TaskId);

        await rig.UntagAsync(id);
        var untagging = await rig.RunAsync();

        Assert.Null(untagging.Problem);
        Assert.Equal(0, untagging.EventsRefused);
        Assert.Single(rig.Fake.Events(rig.CalendarId));
    }

    [Fact]
    public async Task A_delete_refused_by_the_calendar_keeps_the_event_and_one_already_gone_counts_as_deleted()
    {
        var kept = await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-12-07"));
        var gone = await rig.AddTaskAsync("Gym", CalendarRig.Day("2026-12-08"));
        await rig.RunAsync();
        var events = rig.Fake.Events(rig.CalendarId);
        var dentist = events.Single(each => each.Data.Summary == "Dentist");
        var gym = events.Single(each => each.Data.Summary == "Gym");
        rig.Fake.RefuseWrites(dentist.Id);
        rig.Fake.RefuseWrites(gym.Id, new CalendarProblem(CalendarProblemKind.NotFound, "calendar_not_found", "Google answered 410 (deleted)"));

        await rig.UntagAsync(kept);
        await rig.UntagAsync(gone);
        var run = await rig.RunAsync();

        Assert.Null(run.Problem);
        Assert.Equal(1, run.EventsRefused);
        Assert.Equal(1, run.EventsDeleted);
        var item = Assert.Single(await rig.Calendars.ItemsAsync(rig.LinkId, Token));
        Assert.Equal(dentist.Id, item.EventId);
        Assert.Null(item.TaskId);
        Assert.Equal(0, (await rig.RunAsync()).EventsRefused);
    }

    [Fact]
    public async Task A_run_cut_short_keeps_what_it_wrote_so_the_next_run_pairs_instead_of_writing_again()
    {
        var first = rig.Fake.Seed(rig.CalendarId, new EventData("Alpha", "", CalendarTime.Date("2026-12-01"), CalendarTime.Date("2026-12-02")));
        var second = rig.Fake.Seed(rig.CalendarId, new EventData("Bravo", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")));
        var third = rig.Fake.Seed(rig.CalendarId, new EventData("Charlie", "", CalendarTime.Date("2026-12-03"), CalendarTime.Date("2026-12-04")));
        // The listing comes in id order: the first two are marked, then the service stops answering.
        Assert.Equal([first.Id, second.Id, third.Id], new[] { first.Id, second.Id, third.Id }.Order(StringComparer.Ordinal));
        rig.Fake.HangWrites(third.Id);

        var cut = await rig.NewEngine(deadline: TimeSpan.FromMilliseconds(500)).SyncLinkAsync(rig.LinkId, Token);

        Assert.Equal(CalendarSync.TimedOut, cut.Problem);
        Assert.Equal(["Alpha", "Bravo"], (await rig.TasksAsync()).Select(task => (string)task["title"]!).Order(StringComparer.Ordinal));
        var saved = await rig.Calendars.ItemsAsync(rig.LinkId, Token);
        Assert.Equal([first.Id, second.Id], saved.Where(item => item.TaskId is not null).Select(item => item.EventId).Order(StringComparer.Ordinal));
        Assert.Null((await rig.Calendars.LinkAsync(rig.LinkId, Token))!.SyncToken);
        var marked = rig.Fake.Event(rig.CalendarId, first.Id)!;

        rig.Fake.HangWrites(third.Id, hang: false);
        var after = await rig.RunAsync();

        Assert.Null(after.Problem);
        Assert.Equal(1, after.TasksCreated);
        Assert.Equal(["Alpha", "Bravo", "Charlie"], (await rig.TasksAsync()).Select(task => (string)task["title"]!).Order(StringComparer.Ordinal));
        // Paired from what the cut run saved, not marked a second time.
        Assert.Equal(marked.Etag, rig.Fake.Event(rig.CalendarId, first.Id)!.Etag);
    }

    [Fact]
    public async Task An_event_marked_for_a_task_that_never_landed_is_marked_once_more_and_then_left_alone()
    {
        var instance = await rig.Instance.GetAsync(Token);
        // As a run before these fixes left it: marked at the calendar, its task never written.
        var stray = rig.Fake.Seed(rig.CalendarId, new EventData("Team lunch", "", CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03"),
            Marker: new EventMarker(instance, "01JDZKNEVERWRITTEN00000000")));

        var run = await rig.RunAsync();

        var task = Assert.Single(await rig.TasksAsync());
        Assert.Equal(1, run.TasksCreated);
        var restamped = rig.Fake.Event(rig.CalendarId, stray.Id)!;
        Assert.Equal(new EventMarker(instance, (string)task["id"]!), restamped.Data.Marker);

        // A full listing again, with the pairs kept: paired by them, not stamped again.
        await rig.Calendars.SaveLinkAsync((await rig.Calendars.LinkAsync(rig.LinkId, Token))! with { SyncToken = null }, Token);
        await rig.RunAsync();

        Assert.Equal(restamped.Etag, rig.Fake.Event(rig.CalendarId, stray.Id)!.Etag);
        Assert.Single(await rig.TasksAsync());
    }

    [Fact]
    public async Task An_adapter_bug_backs_the_link_off_like_a_failing_service()
    {
        rig.Fake.FailNext(new InvalidOperationException("2026-13-45 is not a date"), times: 2);

        await Assert.ThrowsAsync<InvalidOperationException>(() => rig.RunAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => rig.RunAsync());

        var link = (await rig.Calendars.LinkAsync(rig.LinkId, Token))!;
        Assert.Equal(CalendarSync.Failed, link.Problem);
        Assert.Equal(2, link.Failures);
        Assert.Equal(rig.Time.Now + TimeSpan.FromMinutes(2), link.NextAttempt);
        Assert.Null((await rig.RunAsync()).Problem);
        Assert.Equal(0, (await rig.Calendars.LinkAsync(rig.LinkId, Token))!.Failures);
    }

    private static EventData Weekly => new("Gym", "", CalendarTime.Date("2026-11-30"), CalendarTime.Date("2026-12-01"), "FREQ=WEEKLY;COUNT=4");

    private static EventData MovedGym => new("Gym (Tuesday)", "", CalendarTime.Date("2026-12-08"), CalendarTime.Date("2026-12-09"));

    [Fact]
    public async Task A_deleted_series_takes_its_overrides_with_it()
    {
        var series = rig.Fake.Seed(rig.CalendarId, Weekly);
        var single = rig.Fake.AddOverride(rig.CalendarId, series.Id, CalendarTime.Date("2026-12-07"), MovedGym);
        await rig.RunAsync();
        Assert.Contains(await rig.Calendars.ItemsAsync(rig.LinkId, Token), each => each.EventId == single.Id && each.TaskId is null);
        // Where overrides come on their own (Google), a changed series without them keeps them.
        rig.Fake.Edit(rig.CalendarId, series.Id, data => data with { Description = "Bring water" });
        await rig.RunAsync();
        Assert.Contains(await rig.Calendars.ItemsAsync(rig.LinkId, Token), each => each.EventId == single.Id);

        rig.Fake.Remove(rig.CalendarId, series.Id);
        await rig.RunAsync();

        Assert.Empty(await rig.Calendars.ItemsAsync(rig.LinkId, Token));
    }

    [Fact]
    public async Task Where_a_series_lists_its_overrides_one_it_no_longer_lists_is_gone()
    {
        await using var caldav = await CalendarRig.StartAsync(seriesListsOverrides: true);
        var series = caldav.Fake.Seed(caldav.CalendarId, Weekly);
        var single = caldav.Fake.AddOverride(caldav.CalendarId, series.Id, CalendarTime.Date("2026-12-07"), MovedGym);
        await caldav.RunAsync();

        // Put back in its place by another app: the series changes, the override is simply not in it any more.
        caldav.Fake.UnmoveOccurrence(caldav.CalendarId, single.Id);
        await caldav.RunAsync();

        var item = Assert.Single(await caldav.Calendars.ItemsAsync(caldav.LinkId, Token));
        Assert.Equal(series.Id, item.EventId);
    }

    [Fact]
    public async Task An_event_whose_task_is_not_there_is_kept_not_deleted()
    {
        await rig.AddTaskAsync("Dentist", CalendarRig.Day("2026-11-30"));
        await rig.RunAsync();
        var item = Assert.Single(await rig.Calendars.ItemsAsync(rig.LinkId, Token));
        // As when the task made from an event never landed: the pair points at nothing.
        await rig.Calendars.SaveItemsAsync(rig.LinkId, [item with { TaskId = "01JDZKNOSUCHTASK0000000000" }], [], Token);
        rig.Fake.Edit(rig.CalendarId, item.EventId, data => data with { Summary = "Dentist (moved)" });

        var run = await rig.RunAsync();

        Assert.Equal(0, run.EventsDeleted);
        Assert.Equal("Dentist (moved)", OnlyEvent().Data.Summary);
        Assert.Null(Assert.Single(await rig.Calendars.ItemsAsync(rig.LinkId, Token)).TaskId);
    }

    [Fact]
    public async Task A_description_longer_than_notes_may_be_is_cut_on_the_task_and_left_whole_on_the_calendar()
    {
        var description = new string('x', CalendarMapping.MaxNotes + 50);
        rig.Fake.Seed(rig.CalendarId, new EventData("Minutes", description, CalendarTime.Date("2026-12-02"), CalendarTime.Date("2026-12-03")));

        await rig.RunAsync();
        var again = await rig.RunAsync();

        Assert.Equal(CalendarMapping.MaxNotes, ((string)Assert.Single(await rig.TasksAsync())["notes"]!).Length);
        Assert.Equal(description, OnlyEvent().Data.Description);
        Assert.Equal(new CalendarRun(), again);
    }

    [Fact]
    public async Task A_tag_that_is_gone_stops_the_link_with_a_problem()
    {
        await rig.Calendars.SaveLinkAsync(CalendarRig.NewLink(rig.LinkId, rig.CalendarId, "01JDZKNOSUCHTAG00000000000"), Token);

        var run = await rig.RunAsync();

        Assert.Equal("unknown_tag", run.Problem);
        Assert.Equal("unknown_tag", (await rig.Calendars.LinkAsync(rig.LinkId, Token))!.Problem);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    public async Task Edits_on_both_sides_in_any_order_converge(int seed)
    {
        var random = new Random(seed * 7919);
        for (var each = 0; each < 5; each++)
        {
            await rig.AddTaskAsync($"Task {each}", random.Next(2) == 0 ? CalendarRig.Day($"2026-12-{10 + each}") : CalendarRig.At($"2026-12-{10 + each}T09:00", $"2026-12-{10 + each}T10:00"));
        }
        for (var each = 0; each < 3; each++)
        {
            rig.Fake.Seed(rig.CalendarId, new EventData($"Event {each}", "", CalendarTime.Date($"2026-12-{20 + each}"), CalendarTime.Date($"2026-12-{21 + each}")));
        }
        await rig.RunAsync();

        var log = new List<string>();
        for (var round = 0; round < 4; round++)
        {
            rig.Time.Advance(TimeSpan.FromMinutes(1));
            log.AddRange(rig.Fake.Drift(rig.CalendarId, seed * 100 + round, 4));
            foreach (var task in (await rig.TasksAsync()).Where(task => random.Next(3) == 0))
            {
                rig.Time.Advance(TimeSpan.FromSeconds(10));
                var id = (string)task["id"]!;
                switch (random.Next(5))
                {
                    case 0:
                        await rig.EditTaskAsync(id, new JsonObject { ["title"] = $"Edited {round}" });
                        log.Add($"retitle task {id}");
                        break;
                    case 1:
                        await rig.EditTaskAsync(id, new JsonObject { ["schedule"] = CalendarRig.Day($"2026-12-{1 + random.Next(28):D2}") });
                        log.Add($"move task {id}");
                        break;
                    case 2:
                        await rig.EditTaskAsync(id, new JsonObject { ["deletedAt"] = rig.Clock.Now() });
                        log.Add($"delete task {id}");
                        break;
                    case 3:
                        await rig.UntagAsync(id);
                        log.Add($"untag task {id}");
                        break;
                    default:
                        await rig.AddTaskAsync($"Added {round}", CalendarRig.Day($"2026-12-{1 + random.Next(28):D2}"));
                        log.Add("add task");
                        break;
                }
            }
            rig.Time.Advance(TimeSpan.FromMinutes(1));
            await rig.RunAsync();
        }
        var last = await rig.RunAsync();

        var instance = await rig.Instance.GetAsync(Token);
        var inScope = (await rig.TasksAsync()).Where(task => Tagged(task) && task["schedule"] is JsonObject).ToList();
        var events = rig.Fake.Events(rig.CalendarId);
        var because = $"seed {seed}: {string.Join("; ", log)}";
        Assert.True(new CalendarRun() == last, $"a settled run writes nothing ({last}); {because}");
        Assert.True(inScope.Count == events.Count, $"{inScope.Count} tasks, {events.Count} events; {because}");
        foreach (var task in inScope)
        {
            var id = (string)task["id"]!;
            var match = events.SingleOrDefault(each => each.Data.Marker?.TaskId == id);
            Assert.True(match is not null, $"task {id} has its event; {because}");
            Assert.True(CalendarJson.Same(CalendarMapping.EventOf(task, new EventMarker(instance, id), CalendarRig.Zone)!, match.Data),
                $"task {id} and its event agree; {because}");
        }
    }
}
