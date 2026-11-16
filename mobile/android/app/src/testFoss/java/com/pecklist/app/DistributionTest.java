package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

/** The foss build (the GitLab APK, F-Droid) says so, and keeps its payment links. */
public class DistributionTest {

    @Test
    public void theFossBuildSaysFossAndOpensPaymentLinks() {
        assertEquals("foss", Distribution.NAME);
        assertFalse(Distribution.isPlay());
        assertFalse(PaymentLinks.blocked(Distribution.isPlay(), "https", "ko-fi.com", "/S6S7P3FVW"));
    }
}
