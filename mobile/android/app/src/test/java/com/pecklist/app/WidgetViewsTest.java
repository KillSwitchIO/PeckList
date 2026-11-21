package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

/** What a Today widget can be set to show (PL-121): the choices, the keys and the pages. */
public class WidgetViewsTest {

    private static WidgetViews.View view(String key, String kind, String name) {
        return new WidgetViews.View(key, kind, name, "#5A8A4E", Collections.emptyList());
    }

    private final List<WidgetViews.View> handed = Arrays.asList(
        view("list:01INBOX", "inbox", "Inbox"),
        view("filter:01URGENT", "filter", "Urgent"),
        view("list:01GARDEN", "list", "Garden"));

    private static List<String> keys(List<WidgetViews.View> views) {
        List<String> keys = new ArrayList<>();
        for (WidgetViews.View each : views) keys.add(each.key);
        return keys;
    }

    @Test
    public void offersTodayUpcomingThenTheListsThenTheFilters() {
        List<WidgetViews.View> choices = WidgetViews.choices(handed, true, "Today", "Upcoming");
        assertEquals(Arrays.asList("today", "upcoming", "list:01INBOX", "list:01GARDEN", "filter:01URGENT"), keys(choices));
        assertEquals("Today", choices.get(0).name);
        assertEquals("Upcoming", choices.get(1).name);
    }

    @Test
    public void offersOnlyTodayUntilTheAppHandsOverItsListsAndFilters() {
        // Never opened, or an older web app: Upcoming needs the newer hand-over too.
        assertEquals(Collections.singletonList("today"), keys(WidgetViews.choices(Collections.emptyList(), false, "Today", "Upcoming")));
    }

    @Test
    public void takesOnlyKeysWithASafeId() {
        assertTrue(WidgetViews.valid("today"));
        assertTrue(WidgetViews.valid("upcoming"));
        assertTrue(WidgetViews.valid("list:01GARDEN"));
        assertTrue(WidgetViews.valid("filter:01URGENT"));
        assertFalse(WidgetViews.valid(null));
        assertFalse(WidgetViews.valid("tag:home"));
        assertFalse(WidgetViews.valid("list:"));
        assertFalse(WidgetViews.valid("list:../admin"));
        assertFalse(WidgetViews.valid("filter:a?add=1&next=https://evil.example"));
        // Dropped from a hand-over, so never offered.
        List<WidgetViews.View> odd = Collections.singletonList(view("list:../admin", "list", "Odd"));
        assertEquals(Arrays.asList("today", "upcoming"), keys(WidgetViews.choices(odd, true, "Today", "Upcoming")));
    }

    @Test
    public void opensEachViewsOwnPageAndShortcutsAllowsItAndItsAddBar() {
        assertEquals("/today", WidgetViews.page("today", null));
        assertEquals("/upcoming", WidgetViews.page("upcoming", null));
        assertEquals("/inbox", WidgetViews.page("list:01INBOX", handed.get(0)));
        assertEquals("/lists/01GARDEN", WidgetViews.page("list:01GARDEN", handed.get(2)));
        assertEquals("/filters/01URGENT", WidgetViews.page("filter:01URGENT", handed.get(1)));
        assertEquals("/today", WidgetViews.page("tag:home", null));
        for (String page : new String[] { "/today", "/upcoming", "/inbox", "/lists/01GARDEN", "/filters/01URGENT" }) {
            assertEquals(page, Shortcuts.pageOf(Shortcuts.ACTION, Shortcuts.SCHEME + ":" + page));
            assertEquals(page + "?add=1", Shortcuts.pageOf(Shortcuts.ACTION, Shortcuts.SCHEME + ":" + page + "?add=1"));
        }
    }

    @Test
    public void findsAHandedOverViewByItsKey() {
        assertSame(handed.get(2), WidgetViews.find(handed, "list:01GARDEN"));
        assertNull(WidgetViews.find(handed, "list:01GONE"));
    }

    @Test
    public void showsAListInItsOrderAndUpcomingThroughItsWeek() {
        Map<String, WidgetTasks.Task> all = new HashMap<>();
        for (WidgetTasks.Task each : Arrays.asList(
            new WidgetTasks.Task("weed", "Weed", null, null, null, 0, ""),
            new WidgetTasks.Task("water", "Water", "2026-11-18", "2026-11-18", null, 3, ""),
            new WidgetTasks.Task("mow", "Mow", "2026-11-21", "2026-11-21", "09:00", 0, ""),
            new WidgetTasks.Task("rake", "Rake", "2026-11-20", "2026-11-20", null, 0, ""),
            new WidgetTasks.Task("prune", "Prune", "2026-11-26", "2026-11-26", null, 0, ""),
            new WidgetTasks.Task("plant", "Plant", "2026-11-27", "2026-11-27", null, 0, ""))) {
            all.put(each.id, each);
        }
        List<WidgetTasks.Shown> list = WidgetTasks.inView(all, Arrays.asList("weed", "water", "gone", "mow"), "2026-11-19",
            "2026-11-19", Collections.singleton("mow"));
        assertEquals(2, list.size());
        assertEquals("Weed", list.get(0).task.title);
        assertNull(list.get(0).day);
        assertFalse(list.get(0).overdue);
        assertTrue(list.get(1).overdue);

        List<String> ids = Arrays.asList("plant", "prune", "mow", "rake");
        List<String> titles = new ArrayList<>();
        for (WidgetTasks.Shown each : WidgetTasks.upcoming(all, ids, "2026-11-19", "2026-11-19", Collections.emptySet())) {
            titles.add(each.task.title);
        }
        // Tomorrow through a week ahead, by day: the 27th is a day past it.
        assertEquals(Arrays.asList("Rake", "Mow", "Prune"), titles);
        titles.clear();
        // A day later without the app: tomorrow's is today's now, and the 27th comes in.
        for (WidgetTasks.Shown each : WidgetTasks.upcoming(all, ids, "2026-11-19", "2026-11-20", Collections.emptySet())) {
            titles.add(each.task.title);
        }
        assertEquals(Arrays.asList("Mow", "Prune", "Plant"), titles);
    }

    @Test
    public void addsDaysAcrossMonthsAndYears() {
        assertEquals("2026-12-03", WidgetTasks.addDays("2026-11-26", 7));
        assertEquals("2027-01-02", WidgetTasks.addDays("2026-12-26", 7));
        assertEquals("2028-03-01", WidgetTasks.addDays("2028-02-23", 7));
    }

    @Test
    public void undoShowsOnlyOnTheWidgetsThatHeldTheTask() {
        WidgetViews.View garden = new WidgetViews.View("list:01GARDEN", "list", "Garden", "#5A8A4E", Arrays.asList("weed", "water"));
        List<WidgetTasks.Task> today = Arrays.asList(new WidgetTasks.Task("call", "Call", "2026-10-21", null, null, 0, ""));
        List<String> upcoming = Arrays.asList("water");
        assertTrue(WidgetViews.holds("list:01GARDEN", garden, today, upcoming, "weed"));
        assertFalse(WidgetViews.holds(WidgetViews.TODAY, null, today, upcoming, "weed"));
        assertTrue(WidgetViews.holds(WidgetViews.TODAY, null, today, upcoming, "call"));
        assertTrue(WidgetViews.holds(WidgetViews.UPCOMING, null, today, upcoming, "water"));
        assertFalse(WidgetViews.holds(WidgetViews.UPCOMING, null, today, upcoming, "weed"));
        // A list the hand-over no longer has holds nothing.
        assertFalse(WidgetViews.holds("list:01GONE", null, today, upcoming, "weed"));
    }
}
