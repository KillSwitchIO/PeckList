package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The Google Play build says so, and opens no payment links. */
public class DistributionTest {

    @Test
    public void thePlayBuildSaysPlayAndOpensNoPaymentLinks() {
        assertEquals("play", Distribution.NAME);
        assertTrue(Distribution.isPlay());
        assertTrue(PaymentLinks.blocked(Distribution.isPlay(), "https", "ko-fi.com", "/S6S7P3FVW"));
        assertTrue(PaymentLinks.blocked(Distribution.isPlay(), "https", "pecklist.com", "/support"));
    }
}
