package com.killswitch10.pecklist;

import static org.junit.Assert.assertEquals;

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
}
