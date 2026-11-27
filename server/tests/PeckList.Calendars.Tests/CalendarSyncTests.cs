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

        Assert.Equal($"calendar_refused (Google answered 400 (eventTypeRestriction)) in update for event {birthday.Id}", marking.Detail);
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
