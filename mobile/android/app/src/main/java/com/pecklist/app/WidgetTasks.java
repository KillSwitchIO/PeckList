package com.pecklist.app;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * What the home-screen widgets show (PL-121), worked out from the web app's last hand-over (shell
 * api 12, WidgetStore) and the phone's date when they draw: today's open tasks, overdue first, so a
 * widget is right after midnight without the app. Plain Java, so the rules test without a phone.
 */
final class WidgetTasks {

    private WidgetTasks() {}

    /** One task as the web app hands it over (web/src/core/widgetTasks.ts). */
    static final class Task {
        final String id;
        final String title;
        /** The day it belongs to in Today, on the hand-over's day and on the day after. */
        final String on;
        final String next;
        /** "HH:mm", or null for an all-day task. */
        final String time;
        final int priority;
        final String color;

        Task(String id, String title, String on, String next, String time, int priority, String color) {
            this.id = id;
            this.title = title;
            this.on = on;
            this.next = next;
            this.time = time;
            this.priority = priority;
            this.color = color;
        }
    }

    /** A task as a widget shows it on a day. */
    static final class Shown {
        final Task task;
        /** Null for a task with no date (a list or a saved filter shows those). */
        final String day;
        final boolean overdue;

        Shown(Task task, String day, boolean overdue) {
            this.task = task;
            this.day = day;
            this.overdue = overdue;
        }
    }

    /**
     * Today's tasks on {@code today} (the phone's "YYYY-MM-DD"), from a hand-over made on {@code
     * asOf}, leaving out {@code hidden} (ticked off on the widget). After the hand-over's day each
     * task's next day counts; overdue first, oldest first, then timed by time, then the rest.
     */
    static List<Shown> today(List<Task> tasks, String asOf, String today, Collection<String> hidden) {
        boolean later = asOf != null && today.compareTo(asOf) > 0;
        List<Shown> shown = new ArrayList<>();
        for (Task each : tasks) {
            if (hidden.contains(each.id)) continue;
            String day = later ? each.next : each.on;
            if (day == null || day.compareTo(today) > 0) continue;
            shown.add(new Shown(each, day, day.compareTo(today) < 0));
        }
        shown.sort((a, b) -> {
            if (a.overdue != b.overdue) return a.overdue ? -1 : 1;
            int byDay = a.day.compareTo(b.day);
            if (byDay != 0) return byDay;
            String at = a.task.time == null ? "99:99" : a.task.time;
            String bt = b.task.time == null ? "99:99" : b.task.time;
            int byTime = at.compareTo(bt);
            return byTime != 0 ? byTime : a.task.title.compareTo(b.task.title);
        });
        return shown;
    }

    /** How many days ahead Upcoming shows, from tomorrow, as the Upcoming page does. */
    static final int UPCOMING_DAYS = 7;

    /**
     * Upcoming on {@code today}: of the tasks the hand-over named for it ({@code ids}, from
     * tomorrow through a day past its week), those from tomorrow through {@link #UPCOMING_DAYS}
     * days ahead, by day, then time, then title. After the hand-over's day each task's next day
     * counts, so it moves on at midnight without the app.
     */
    static List<Shown> upcoming(Map<String, Task> all, List<String> ids, String asOf, String today,
        Collection<String> hidden) {
        boolean later = asOf != null && today.compareTo(asOf) > 0;
        String last = addDays(today, UPCOMING_DAYS);
        List<Shown> shown = new ArrayList<>();
        for (String id : ids) {
            Task each = all.get(id);
            if (each == null || hidden.contains(id)) continue;
            String day = later ? each.next : each.on;
            if (day == null || day.compareTo(today) <= 0 || day.compareTo(last) > 0) continue;
            shown.add(new Shown(each, day, false));
        }
        shown.sort((a, b) -> {
            int byDay = a.day.compareTo(b.day);
            if (byDay != 0) return byDay;
            String at = a.task.time == null ? "99:99" : a.task.time;
            String bt = b.task.time == null ? "99:99" : b.task.time;
            int byTime = at.compareTo(bt);
            return byTime != 0 ? byTime : a.task.title.compareTo(b.task.title);
        });
        return shown;
    }

    /**
     * A list's or saved filter's tasks, in the order the app shows them ({@code ids}), leaving out
     * {@code hidden}. A task's day may be none; one before {@code today} is overdue.
     */
    static List<Shown> inView(Map<String, Task> all, List<String> ids, String asOf, String today,
        Collection<String> hidden) {
        boolean later = asOf != null && today.compareTo(asOf) > 0;
        List<Shown> shown = new ArrayList<>();
        for (String id : ids) {
            Task each = all.get(id);
            if (each == null || hidden.contains(id)) continue;
            String day = later ? each.next : each.on;
            shown.add(new Shown(each, day, day != null && day.compareTo(today) < 0));
        }
        return shown;
    }

    /** "YYYY-MM-DD" plus some days. */
    static String addDays(String day, int days) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        try {
            Date at = format.parse(day);
            if (at == null) return day;
            Calendar calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.US);
            calendar.setTime(at);
            calendar.add(Calendar.DAY_OF_YEAR, days);
            return format.format(calendar.getTime());
        } catch (ParseException error) {
            return day;
        }
    }

    /** The count widget's number and whether any of it is overdue. */
    static int[] count(List<Task> tasks, String asOf, String today, Collection<String> hidden) {
        int open = 0;
        int overdue = 0;
        for (Shown each : today(tasks, asOf, today, hidden)) {
            open++;
            if (each.overdue) overdue++;
        }
        return new int[] { open, overdue };
    }

    /** Whether an id may go into a page address (Shortcuts' allowlist takes the same). */
    static boolean safeId(String id) {
        return id != null && id.matches("[A-Za-z0-9_-]{1,64}");
    }
}
