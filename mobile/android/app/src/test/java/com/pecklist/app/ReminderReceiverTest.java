package com.pecklist.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

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
}
