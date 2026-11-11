package com.killswitch10.pecklist;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class BackgroundCheckTest {

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
        assertEquals("https://tasks.example.com/api/app/check?zone=[Europe/Oslo]",
            BackgroundCheck.checkAddress("https://tasks.example.com", "Europe/Oslo", null, false, each -> "[" + each + "]"));
        assertEquals("https://tasks.example.com/api/app/check?zone=[Europe/Oslo]&after=[01J]&reminders=0",
            BackgroundCheck.checkAddress("https://tasks.example.com", "Europe/Oslo", "01J", true, each -> "[" + each + "]"));
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
}
