package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import org.junit.Test;

public class ClockTest {

    /** Once the app has said which clock it reads (Automatic worked out from its language), that one. */
    @Test
    public void theAppsClockWinsOverThePhones() {
        assertTrue(Clock.decide(true, false));
        assertFalse(Clock.decide(false, true));
    }

    /** Before the app has said (a widget drawn before the app first ran): the phone's own setting. */
    @Test
    public void untilThenThePhonesOwn() {
        assertTrue(Clock.decide(null, true));
        assertFalse(Clock.decide(null, false));
    }

    /** A check-in says the clock picked anywhere: snooze and the widgets follow it (QA, rc.2). */
    @Test
    public void aCheckInSaysTheClockPicked() {
        assertEquals(Boolean.TRUE, Clock.picked("24h"));
        assertEquals(Boolean.FALSE, Clock.picked("12h"));
        assertEquals(null, Clock.picked("auto")); // the phone's own
        assertTrue(Clock.said("auto"));
        // An older server says nothing, and something unknown changes nothing.
        assertFalse(Clock.said(null));
        assertFalse(Clock.said("13h"));
    }

    private static Date at(int day, int hour) {
        Calendar calendar = Calendar.getInstance();
        calendar.clear();
        calendar.set(2026, Calendar.DECEMBER, day, hour, 0);
        return calendar.getTime();
    }

    private static final Locale FRENCH = Locale.FRENCH;

    /** French writes the first of a month "1er" beside the month's name, as the web app does (PL-148). */
    @Test
    public void theFirstOfAMonthInFrenchIs1er() {
        assertEquals("mar. 1er déc. 15:00", Clock.formatDate("EEE d MMM HH:mm", FRENCH, at(1, 15)));
        assertEquals("1er déc.", Clock.formatDate("d MMM", FRENCH, at(1, 15)));
        assertEquals("1er décembre 2026", Clock.formatDate("d MMMM y", FRENCH, at(1, 15)));
        assertEquals("1er déc.", Clock.formatDate("d MMM", Locale.CANADA_FRENCH, at(1, 15)));
        // The hour's 1 is not the day's.
        assertEquals("1er déc. 1:00", Clock.formatDate("d MMM H:mm", FRENCH, at(1, 1)));
    }

    /** Not in numbers, not on other days, not in other languages, and not a month in quotes. */
    @Test
    public void elsewhereTheDayStaysANumber() {
        assertEquals("01/12", Clock.formatDate("dd/MM", FRENCH, at(1, 15)));
        assertEquals("1/12", Clock.formatDate("d/M", FRENCH, at(1, 15)));
        assertEquals("sam. 5 déc. 1:00", Clock.formatDate("EEE d MMM H:mm", FRENCH, at(5, 1)));
        assertEquals("Dec 1", Clock.formatDate("MMM d", Locale.US, at(1, 15)));
        assertEquals("1. Dez.", Clock.formatDate("d. MMM", Locale.GERMAN, at(1, 15)));
        assertFalse(Clock.namesTheMonth("d 'MMM' M"));
        assertTrue(Clock.namesTheMonth("d LLLL"));
    }
}
