package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.os.Build;
import org.junit.Test;

public class ExactAlarmsTest {

    private static final int ANDROID_11 = Build.VERSION_CODES.R;
    private static final int ANDROID_14 = Build.VERSION_CODES.UPSIDE_DOWN_CAKE;

    @Test
    public void beforeAndroid12ExactAlarmsNeedNoLeaveAndThereIsNothingToAsk() {
        assertTrue(ExactAlarms.allowed(ANDROID_11, false));
        assertFalse(ExactAlarms.canAsk(ANDROID_11, false));
    }

    /** The Play build on Android 14: off until the person allows them, then on. */
    @Test
    public void fromAndroid12TheyFollowTheAllowAndThePageIsOfferedUntilThen() {
        assertFalse(ExactAlarms.allowed(ANDROID_14, false));
        assertTrue(ExactAlarms.canAsk(ANDROID_14, false));
        assertTrue(ExactAlarms.allowed(ANDROID_14, true));
        assertFalse(ExactAlarms.canAsk(ANDROID_14, true));
    }

    @Test
    public void thePlayBuildOpensTheListOfAppsForBatteryOptimizationAndFossAsksDirectly() {
        assertEquals(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS, BackgroundCheck.batteryAction(true));
        assertEquals(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, BackgroundCheck.batteryAction(false));
    }
}
