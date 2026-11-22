package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class BackgroundCheckTest {

    private static Reminders.Reminder at(String key, long at, boolean local) {
        return new Reminders.Reminder(key, "t", "b", at, "/today", false, false, local);
    }

    /**
     * 0.14.0: a check-in a minute before the soonest of the server's reminders that leaves room, so a
     * task done on another device takes it off first; not for a task the server does not have, a
     * quiet copy, or one too near to check before.
     */
    @Test
    public void aCheckInGoesAMinuteBeforeTheNextReminderTheServerSet() {
        long now = 10_000_000L;
        assertEquals(-1, BackgroundCheck.beforeAt(Collections.emptyList(), now));
        assertEquals(now + 600_000 - BackgroundCheck.BEFORE_MS, BackgroundCheck.beforeAt(Arrays.asList(
            at("LATER@1", now + 3_600_000, false),
            at("SNOOZED@2", now + 600_000, false),
            at("NEW@3", now + 300_000, true),
            at("QUIET@4#quiet", now + 300_000, false),
            at("NEAR@5", now + 70_000, false)), now));
        // Only one too near, or none of the server's: none.
        assertEquals(-1, BackgroundCheck.beforeAt(Arrays.asList(at("NEAR@5", now + 70_000, false), at("NEW@3", now + 300_000, true)), now));
        // Just room enough.
        assertEquals(now + BackgroundCheck.BEFORE_FLOOR_MS, BackgroundCheck.beforeAt(Collections.singletonList(
            at("EDGE@6", now + BackgroundCheck.BEFORE_FLOOR_MS + BackgroundCheck.BEFORE_MS, false)), now));
    }

    /** Audit E1: twice as long after each failure in a row, never past two hours, never under the interval. */
    @Test
    public void failuresSlowTheCheckInDown() {
        assertEquals(5, BackgroundCheck.delayMinutes(5, 0));
        assertEquals(10, BackgroundCheck.delayMinutes(5, 1));
        assertEquals(40, BackgroundCheck.delayMinutes(5, 3));
        assertEquals(BackgroundCheck.MAX_BACKOFF_MINUTES, BackgroundCheck.delayMinutes(5, 10));
        assertEquals(BackgroundCheck.MAX_BACKOFF_MINUTES, BackgroundCheck.delayMinutes(60, 2));
        // An interval longer than the cap is kept as it is.
        assertEquals(60, BackgroundCheck.delayMinutes(60, 0));
    }

    /** Audit P7: with the app on screen the check asks for no reminders, which go unused there. */
    @Test
    public void onScreenTheCheckAsksForNoReminders() {
        assertEquals("https://tasks.example.com/api/app/check?zone=[Europe/Oslo]&clock24=0",
            BackgroundCheck.checkAddress("https://tasks.example.com", "Europe/Oslo", null, false, false, each -> "[" + each + "]"));
        assertEquals("https://tasks.example.com/api/app/check?zone=[Europe/Oslo]&after=[01J]&reminders=0&clock24=0",
            BackgroundCheck.checkAddress("https://tasks.example.com", "Europe/Oslo", "01J", true, false, each -> "[" + each + "]"));
    }

    /** Dev 1, S3: the phone's own 12/24-hour setting goes along, for the reminders the server words. */
    @Test
    public void theCheckSaysThePhonesClock() {
        assertEquals("https://tasks.example.com/api/app/check?zone=[UTC]&clock24=1",
            BackgroundCheck.checkAddress("https://tasks.example.com", "UTC", null, false, true, each -> "[" + each + "]"));
    }

    /** The Play build opens the list of apps only for a button pressed, never for an older web app's first run. */
    @Test
    public void thePlayBuildOpensTheListOfAppsOnlyWhenAsked() {
        assertTrue(BackgroundCheck.opensSettings(true, true, false));
        // An older server's web app: its first ask is the first-run prompt (no list), every later
        // one is the button (the list).
        assertFalse(BackgroundCheck.opensSettings(true, false, false));
        assertTrue(BackgroundCheck.opensSettings(true, false, true));
        // The foss build's dialog is a question: asked on the first run too, as before.
        assertTrue(BackgroundCheck.opensSettings(false, false, false));
        assertTrue(BackgroundCheck.opensSettings(false, true, false));
    }

    /** Audit P7: a check that asked for no reminders never hands its empty list over as the alarms. */
    @Test
    public void onlyACheckThatAskedForRemindersHandsThemOver() {
        assertTrue(BackgroundCheck.handsOverReminders(false, false));
        // Asked on screen, answered after the app left it: the answer has none.
        assertFalse(BackgroundCheck.handsOverReminders(true, false));
        // Back on screen by the answer: the web app owns them.
        assertFalse(BackgroundCheck.handsOverReminders(false, true));
        assertFalse(BackgroundCheck.handsOverReminders(true, true));
    }

    /**
     * QA's drill of 2026-11-20: with no check-in yet on this server, the first one (which shows
     * nothing) waited for the regular interval, and news in between was taken as old. Leaving the
     * screen checks in at once then, and only then: on, with a server, and no cursor kept.
     */
    @Test
    public void leavingTheScreenChecksInOnlyWhenThereHasBeenNoCheckInYet() {
        assertTrue(BackgroundCheck.checksInOnLeaving(null, "https://tasks.example", true));
        assertFalse(BackgroundCheck.checksInOnLeaving("01JD0000000000000000000000", "https://tasks.example", true));
        assertFalse(BackgroundCheck.checksInOnLeaving(null, null, true));
        assertFalse(BackgroundCheck.checksInOnLeaving(null, "https://tasks.example", false));
    }

    /**
     * Dev 1's review: the check-in as the app leaves can meet an old session's cookie right after a
     * server is chosen; refused, it must not stop the regular ones (only a fresh start resumes them).
     */
    @Test
    public void onlyARegularCheckInStopsWhenRefused() {
        assertTrue(BackgroundCheck.stopsWhenRefused(false));
        assertFalse(BackgroundCheck.stopsWhenRefused(true));
    }

    /** Two check-ins overlapping: the slower one's older cursor never takes the kept one back. */
    @Test
    public void theCursorOnlyMovesForward() {
        String earlier = "01JD0000000000000000000000";
        String later = "01JD0000010000000000000000";
        assertTrue(BackgroundCheck.laterCursor(null, earlier));
        assertTrue(BackgroundCheck.laterCursor(earlier, later));
        assertFalse(BackgroundCheck.laterCursor(later, earlier));
        assertFalse(BackgroundCheck.laterCursor(later, later));
        // An old server's answer with none keeps what there is.
        assertFalse(BackgroundCheck.laterCursor(earlier, null));
    }

    /** The drill's log line says what a lost notification would need: the first check, and what was left to the app. */
    @Test
    public void eachCheckInSaysWhatItAskedAfterAndWhatItDid() {
        assertEquals("Background check: after none (first check, nothing shown), 0 new, next after C2",
            BackgroundCheck.describe(null, 0, false, "C2"));
        assertEquals("Background check: after C1, 2 new, shown, next after C2", BackgroundCheck.describe("C1", 2, false, "C2"));
        assertEquals("Background check: after C1, 1 new, left to the app on screen, next after C2",
            BackgroundCheck.describe("C1", 1, true, "C2"));
        assertEquals("Background check: after C1, 0 new, next after C1", BackgroundCheck.describe("C1", 0, false, null));
    }
}
