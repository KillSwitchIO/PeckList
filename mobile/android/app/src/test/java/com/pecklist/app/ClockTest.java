package com.pecklist.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

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
}
