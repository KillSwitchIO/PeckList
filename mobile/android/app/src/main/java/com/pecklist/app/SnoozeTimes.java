package com.pecklist.app;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * The snooze picker's arithmetic (SnoozeActivity), apart from Android so it can be tested. A snooze
 * goes to the server as whole minutes from when it hears of it, which counts from the start of that
 * minute: so "until" here is always counted the same way, and the time the toast says is the time
 * the reminder comes back, on the phone and on the server.
 */
final class SnoozeTimes {

    /** The longest snooze the server takes (PushEndpoints: a week). */
    static final int MAX_MINUTES = 7 * 24 * 60;

    /** The Delay tab's quick picks, in minutes; tomorrow morning follows them. */
    static final int[] QUICK = {5, 15, 30, 60, 180};

    /** Tomorrow morning: this hour. */
    static final int TOMORROW_HOUR = 9;

    /** The custom amount's units, in minutes: minutes, hours, days. */
    static final int[] UNITS = {1, 60, 24 * 60};

    private static final long MINUTE = 60_000L;

    private SnoozeTimes() {}

    /** The time a snooze of {@code minutes} pressed at {@code now} comes back. */
    static long until(long now, int minutes) {
        return (now / MINUTE + minutes) * MINUTE;
    }

    /** Minutes from {@code now} until {@code at}, counted as the server counts them (see the class). */
    static long minutesUntil(long now, long at) {
        return Math.floorDiv(at, MINUTE) - now / MINUTE;
    }

    /** Whether a snooze of this many minutes can be sent: at least one, at most a week. */
    static boolean fits(long minutes) {
        return minutes >= 1 && minutes <= MAX_MINUTES;
    }

    /** Tomorrow at {@link #TOMORROW_HOUR}, in minutes from now. */
    static int tomorrowMorning(long now, TimeZone zone) {
        Calendar at = Calendar.getInstance(zone);
        at.setTimeInMillis(now);
        at.add(Calendar.DAY_OF_MONTH, 1);
        at.set(Calendar.HOUR_OF_DAY, TOMORROW_HOUR);
        at.set(Calendar.MINUTE, 0);
        at.set(Calendar.SECOND, 0);
        at.set(Calendar.MILLISECOND, 0);
        return (int) minutesUntil(now, at.getTimeInMillis());
    }

    /** A typed amount of a unit (minutes, hours or days), in minutes; -1 if it is not a snooze the server takes. */
    static int amount(String typed, int unitMinutes) {
        String text = typed == null ? "" : typed.trim();
        if (text.isEmpty() || text.length() > 6) return -1;
        for (int i = 0; i < text.length(); i++) {
            if (text.charAt(i) < '0' || text.charAt(i) > '9') return -1;
        }
        long minutes = Long.parseLong(text) * unitMinutes;
        return fits(minutes) ? (int) minutes : -1;
    }

    /** A picked date and time (to the minute), in minutes from now; -1 if it has passed or is more than a week off. */
    static int at(long now, long at) {
        long minutes = minutesUntil(now, at);
        return fits(minutes) ? (int) minutes : -1;
    }

    /** Where the Date and time tab starts: the next whole hour at least 15 minutes off. */
    static long firstPick(long now, TimeZone zone) {
        Calendar at = Calendar.getInstance(zone);
        at.setTimeInMillis(now + 15 * MINUTE);
        if (at.get(Calendar.MINUTE) != 0 || at.get(Calendar.SECOND) != 0 || at.get(Calendar.MILLISECOND) != 0) {
            at.add(Calendar.HOUR_OF_DAY, 1);
        }
        at.set(Calendar.MINUTE, 0);
        at.set(Calendar.SECOND, 0);
        at.set(Calendar.MILLISECOND, 0);
        return at.getTimeInMillis();
    }

    /**
     * A snooze pressed earlier and sent only now (Pending): the minutes still to go, so it comes back
     * when the person chose, not that long after the server heard of it. 0 once that time has passed:
     * the phone has already shown it again (the web app leaves a held one the same way).
     */
    static int left(int minutes, long pressedAt, long now) {
        long left = minutesUntil(now, until(pressedAt, minutes));
        return left < 1 ? 0 : (int) Math.min(left, MAX_MINUTES);
    }
}
