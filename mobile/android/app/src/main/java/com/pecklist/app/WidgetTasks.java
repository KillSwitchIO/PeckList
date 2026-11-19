package com.pecklist.app;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

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
