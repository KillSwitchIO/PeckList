package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.TimeZone;
import org.junit.Test;

public class ReminderReceiverTest {

    /**
     * A press is sent again later when the server could not be reached, the session is over, the server
     * asked it to wait, or it failed; done, refused (the task gone or not theirs) and 409 (the app finishes it) are not.
     */
    @Test
    public void aPressIsSentAgainOnlyWhenTheServerDidNotHearIt() {
        assertTrue(ReminderReceiver.triesAgain(0));
        assertTrue(ReminderReceiver.triesAgain(401));
        assertTrue(ReminderReceiver.triesAgain(403));
        assertTrue(ReminderReceiver.triesAgain(429));
        assertTrue(ReminderReceiver.triesAgain(500));
        assertTrue(ReminderReceiver.triesAgain(503));
        assertFalse(ReminderReceiver.triesAgain(204));
        assertFalse(ReminderReceiver.triesAgain(404));
        assertFalse(ReminderReceiver.triesAgain(409));
        assertFalse(ReminderReceiver.triesAgain(400));
    }

    /** A snooze its own press may still be sending is left for a later try; a Complete, or an older snooze, is not. */
    @Test
    public void aSnoozeStillOnItsWayIsNotSentAgainAtOnce() {
        long now = 1_000_000_000L;
        assertTrue(Pending.inFlight(Reminders.SNOOZE, now - 1_000, now));
        assertTrue(Pending.inFlight(Reminders.SNOOZE, now - Pending.IN_FLIGHT_MS + 1, now));
        assertFalse(Pending.inFlight(Reminders.SNOOZE, now - Pending.IN_FLIGHT_MS, now));
        assertFalse(Pending.inFlight(Reminders.COMPLETE, now - 1_000, now));
    }

    /** Sent again later: no network, signed out, too many at once, or the server's own trouble. */
    @Test
    public void unreachableOrSignedOutPressesAreSentAgain() {
        for (int status : new int[] { 0, 401, 403, 429, 500, 502, 503 }) assertTrue(String.valueOf(status), ReminderReceiver.triesAgain(status));
    }

    /** Refused for good (the task is gone, or not theirs to change): not sent again, and a widget tick shows again. */
    @Test
    public void refusedPressesAreNotSentAgain() {
        for (int status : new int[] { 400, 404, 410 }) assertFalse(String.valueOf(status), ReminderReceiver.triesAgain(status));
    }

    /**
     * Snooze leaves a reminder that still names the task's time, not when the snooze comes back
     * (Ben, 0.14.0-rc.1: "the time of the event not reminder for time of reminder").
     */
    @Test
    public void aSnoozeKeepsTheTaskTimeInItsText() {
        long first = 1_795_000_000_000L;
        Reminders.Reminder shown = new Reminders.Reminder("T1@" + first, "Dentist", "Due tomorrow, 6:00 AM", first,
            "/today?task=T1", false, true);
        long pressedAt = first + 60_000;
        TimeZone utc = TimeZone.getTimeZone("UTC");
        Reminders.Reminder again = ReminderReceiver.snoozed(shown, 10, pressedAt, utc, "Reminder");
        assertEquals("Due tomorrow, 6:00 AM", again.body);
        assertEquals("Dentist", again.title);
        assertEquals(SnoozeTimes.until(pressedAt, 10), again.at);
        assertEquals("T1@" + again.at, again.tag());
        assertTrue(again.repeats);
    }

    /** A snooze into another day no longer says the day its text was worded for: only "Reminder" (Dev 2's review). */
    @Test
    public void aSnoozeIntoAnotherDaySaysOnlyReminder() {
        TimeZone utc = TimeZone.getTimeZone("UTC");
        // 15:00 UTC on 2026-11-19: "Due 3:00 PM" then.
        long first = 1_795_100_400_000L;
        Reminders.Reminder shown = new Reminders.Reminder("T1@" + first, "Dentist", "Due 3:00 PM", first,
            "/today?task=T1", false, false);
        assertEquals("Reminder", ReminderReceiver.snoozed(shown, 24 * 60, first, utc, "Reminder").body);
        // Later the same day, the text stays.
        assertEquals("Due 3:00 PM", ReminderReceiver.snoozed(shown, 60, first, utc, "Reminder").body);
    }
}
