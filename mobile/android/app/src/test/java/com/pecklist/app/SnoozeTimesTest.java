package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Calendar;
import java.util.TimeZone;
import org.junit.Test;

public class SnoozeTimesTest {

    private static final TimeZone CHICAGO = TimeZone.getTimeZone("America/Chicago");
    private static final long MINUTE = 60_000L;

    /** A local time in Chicago, as ms since the epoch. */
    private static long chicago(int year, int month, int day, int hour, int minute, int second) {
        Calendar at = Calendar.getInstance(CHICAGO);
        at.clear();
        at.set(year, month - 1, day, hour, minute, second);
        return at.getTimeInMillis();
    }

    /** What the toast says is when the server brings it back: whole minutes from the start of the minute. */
    @Test
    public void untilCountsFromTheStartOfTheMinuteAsTheServerDoes() {
        long now = chicago(2026, 11, 17, 16, 20, 42);
        assertEquals(chicago(2026, 11, 17, 16, 35, 0), SnoozeTimes.until(now, 15));
        assertEquals(15, SnoozeTimes.minutesUntil(now, chicago(2026, 11, 17, 16, 35, 0)));
    }

    @Test
    public void tomorrowMorningIsNineTheNextDay() {
        long late = chicago(2026, 11, 17, 23, 50, 10);
        assertEquals(chicago(2026, 11, 18, 9, 0, 0), SnoozeTimes.until(late, SnoozeTimes.tomorrowMorning(late, CHICAGO)));
        long early = chicago(2026, 11, 17, 0, 10, 0);
        assertEquals(chicago(2026, 11, 18, 9, 0, 0), SnoozeTimes.until(early, SnoozeTimes.tomorrowMorning(early, CHICAGO)));
    }

    /** Across the end of daylight saving time the clock time still holds. */
    @Test
    public void tomorrowMorningHoldsAcrossAClockChange() {
        long now = chicago(2026, 10, 31, 20, 0, 0);
        assertEquals(chicago(2026, 11, 1, 9, 0, 0), SnoozeTimes.until(now, SnoozeTimes.tomorrowMorning(now, CHICAGO)));
        assertEquals(14 * 60, SnoozeTimes.tomorrowMorning(now, CHICAGO));
    }

    @Test
    public void aTypedAmountIsMinutesHoursOrDaysUpToAWeek() {
        assertEquals(20, SnoozeTimes.amount("20", SnoozeTimes.UNITS[0]));
        assertEquals(120, SnoozeTimes.amount(" 2 ", SnoozeTimes.UNITS[1]));
        assertEquals(7 * 24 * 60, SnoozeTimes.amount("7", SnoozeTimes.UNITS[2]));
        // Nothing, zero, more than a week, or not a number: Snooze stays off.
        assertEquals(-1, SnoozeTimes.amount("", SnoozeTimes.UNITS[0]));
        assertEquals(-1, SnoozeTimes.amount(null, SnoozeTimes.UNITS[0]));
        assertEquals(-1, SnoozeTimes.amount("0", SnoozeTimes.UNITS[1]));
        assertEquals(-1, SnoozeTimes.amount("8", SnoozeTimes.UNITS[2]));
        assertEquals(-1, SnoozeTimes.amount("169", SnoozeTimes.UNITS[1]));
        assertEquals(-1, SnoozeTimes.amount("-5", SnoozeTimes.UNITS[0]));
        assertEquals(-1, SnoozeTimes.amount("1.5", SnoozeTimes.UNITS[1]));
        assertEquals(-1, SnoozeTimes.amount("99999999999", SnoozeTimes.UNITS[0]));
    }

    @Test
    public void aPickedTimeMustBeAheadAndWithinAWeek() {
        long now = chicago(2026, 11, 17, 16, 20, 42);
        assertEquals(10, SnoozeTimes.at(now, chicago(2026, 11, 17, 16, 30, 0)));
        assertEquals(SnoozeTimes.MAX_MINUTES, SnoozeTimes.at(now, chicago(2026, 11, 24, 16, 20, 0)));
        // This minute, the past, and past a week are refused.
        assertEquals(-1, SnoozeTimes.at(now, chicago(2026, 11, 17, 16, 20, 0)));
        assertEquals(-1, SnoozeTimes.at(now, chicago(2026, 11, 17, 9, 0, 0)));
        assertEquals(-1, SnoozeTimes.at(now, chicago(2026, 11, 24, 16, 21, 0)));
        assertTrue(SnoozeTimes.fits(1));
        assertFalse(SnoozeTimes.fits(0));
        assertFalse(SnoozeTimes.fits(SnoozeTimes.MAX_MINUTES + 1));
    }

    @Test
    public void theDateTabStartsAtTheNextWholeHourAtLeastAQuarterOff() {
        assertEquals(chicago(2026, 11, 17, 17, 0, 0), SnoozeTimes.firstPick(chicago(2026, 11, 17, 16, 20, 0), CHICAGO));
        assertEquals(chicago(2026, 11, 17, 18, 0, 0), SnoozeTimes.firstPick(chicago(2026, 11, 17, 16, 50, 0), CHICAGO));
        assertEquals(chicago(2026, 11, 17, 17, 0, 0), SnoozeTimes.firstPick(chicago(2026, 11, 17, 16, 45, 0), CHICAGO));
        assertEquals(chicago(2026, 11, 18, 0, 0, 0), SnoozeTimes.firstPick(chicago(2026, 11, 17, 23, 30, 0), CHICAGO));
    }

    /** Sent late (offline at the press), a snooze still comes back when the person chose. */
    @Test
    public void aSnoozeSentLateCountsFromThePress() {
        long pressed = chicago(2026, 11, 17, 16, 0, 30);
        long target = SnoozeTimes.until(pressed, 30);
        long sent = chicago(2026, 11, 17, 16, 20, 10);
        int left = SnoozeTimes.left(30, pressed, sent);
        assertEquals(10, left);
        assertEquals(target, SnoozeTimes.until(sent, left));
        // Sent at once, nothing changes.
        assertEquals(30, SnoozeTimes.left(30, pressed, pressed));
        // Once its time has passed, the phone has shown it again: nothing to send.
        assertEquals(0, SnoozeTimes.left(30, pressed, target));
        assertEquals(0, SnoozeTimes.left(30, pressed, target + 3 * MINUTE));
    }
    /** Across the start of daylight saving time too: 9:00 the next morning, an hour fewer in between. */
    @Test
    public void tomorrowMorningHoldsWhenTheClocksGoForward() {
        long now = chicago(2026, 3, 7, 20, 0, 0);
        assertEquals(chicago(2026, 3, 8, 9, 0, 0), SnoozeTimes.until(now, SnoozeTimes.tomorrowMorning(now, CHICAGO)));
        assertEquals(12 * 60, SnoozeTimes.tomorrowMorning(now, CHICAGO));
    }

    /** The week is a week of minutes, not of clock times: across a clock change it ends an hour off the clock. */
    @Test
    public void theWeekLimitCountsMinutesAcrossAClockChange() {
        long now = chicago(2026, 3, 5, 10, 0, 0);
        assertEquals(SnoozeTimes.MAX_MINUTES, SnoozeTimes.at(now, chicago(2026, 3, 12, 11, 0, 0)));
        assertEquals(-1, SnoozeTimes.at(now, chicago(2026, 3, 12, 11, 1, 0)));
    }

    /** A press sent again later: what is left of it, and nothing once it has passed. */
    @Test
    public void aRetriedSnoozeSendsWhatIsLeft() {
        long pressed = chicago(2026, 11, 17, 16, 20, 42);
        assertEquals(30, SnoozeTimes.left(30, pressed, pressed + 5_000));
        assertEquals(10, SnoozeTimes.left(30, pressed, chicago(2026, 11, 17, 16, 40, 5)));
        assertEquals(0, SnoozeTimes.left(30, pressed, chicago(2026, 11, 17, 16, 50, 0)));
        assertEquals(0, SnoozeTimes.left(30, pressed, chicago(2026, 11, 18, 9, 0, 0)));
    }
}
