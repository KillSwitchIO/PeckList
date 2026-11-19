package com.pecklist.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

public class WidgetTasksTest {

    private static WidgetTasks.Task task(String title, String on, String next, String time) {
        return new WidgetTasks.Task("id-" + title, title, on, next, time, 0, "");
    }

    private static List<String> titles(List<WidgetTasks.Shown> shown) {
        List<String> titles = new ArrayList<>();
        for (WidgetTasks.Shown each : shown) titles.add(each.task.title + (each.overdue ? " (overdue)" : ""));
        return titles;
    }

    private final List<WidgetTasks.Task> handed = Arrays.asList(
        task("Untimed", "2026-11-19", "2026-11-19", null),
        task("Later", "2026-11-19", "2026-11-19", "17:30"),
        task("Early", "2026-11-19", "2026-11-19", "08:00"),
        task("Overdue", "2026-11-17", "2026-11-17", null),
        task("Tomorrow", "2026-11-20", "2026-11-20", "09:15"),
        task("Trip", "2026-11-19", "2026-11-20", null));

    @Test
    public void showsTodayOverdueFirstThenByTimeLeavingTomorrowOut() {
        assertEquals(Arrays.asList("Overdue (overdue)", "Early", "Later", "Trip", "Untimed"),
            titles(WidgetTasks.today(handed, "2026-11-19", "2026-11-19", Collections.emptySet())));
    }

    @Test
    public void movesOnAfterMidnightWithoutTheApp() {
        // The hand-over was yesterday's: today's tasks are overdue, tomorrow's are today's, and a
        // task running over days is still today's.
        assertEquals(Arrays.asList("Overdue (overdue)", "Early (overdue)", "Later (overdue)", "Untimed (overdue)", "Tomorrow", "Trip"),
            titles(WidgetTasks.today(handed, "2026-11-19", "2026-11-20", Collections.emptySet())));
    }

    @Test
    public void leavesOutTasksTickedOnTheWidget() {
        assertEquals(Arrays.asList("Overdue (overdue)", "Later", "Trip", "Untimed"),
            titles(WidgetTasks.today(handed, "2026-11-19", "2026-11-19", Collections.singleton("id-Early"))));
    }

    @Test
    public void countsWhatIsLeftAndWhatIsOverdue() {
        assertArrayEquals(new int[] { 5, 1 }, WidgetTasks.count(handed, "2026-11-19", "2026-11-19", Collections.emptySet()));
        assertArrayEquals(new int[] { 0, 0 }, WidgetTasks.count(Collections.emptyList(), null, "2026-11-19", Collections.emptySet()));
    }

    @Test
    public void takesOnlyIdsSafeInAnAddress() {
        assertTrue(WidgetTasks.safeId("01JTASK_a-b"));
        assertFalse(WidgetTasks.safeId("../admin"));
        assertFalse(WidgetTasks.safeId("a&add=1"));
        assertFalse(WidgetTasks.safeId(""));
        assertFalse(WidgetTasks.safeId(null));
    }
}
