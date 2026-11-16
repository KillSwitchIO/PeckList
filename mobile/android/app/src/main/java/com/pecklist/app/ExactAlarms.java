package com.pecklist.app;

import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import com.getcapacitor.JSObject;

/**
 * Reminders at the exact minute (Reminders) and the check-in on time (BackgroundCheck). From
 * Android 12 an app needs leave for exact alarms. The foss build holds USE_EXACT_ALARM, which
 * Android grants a reminders app at install. The Play build holds only SCHEDULE_EXACT_ALARM, which
 * Android 14 and later leave off until the person allows it on a settings page; until then
 * alarms are inexact and Android may hold them back a while. Allowing it sends
 * SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED, on which CheckReceiver sets every alarm again.
 */
final class ExactAlarms {

    private ExactAlarms() {}

    /** Whether exact alarms are allowed on an Android of this level, given what AlarmManager says. */
    static boolean allowed(int sdk, boolean canScheduleExact) {
        return sdk < Build.VERSION_CODES.S || canScheduleExact;
    }

    /** Whether there is a page to allow them on, and a reason to open it: Android 12 and up, not yet allowed. */
    static boolean canAsk(int sdk, boolean canScheduleExact) {
        return sdk >= Build.VERSION_CODES.S && !canScheduleExact;
    }

    static boolean allowed(Context context) {
        return allowed(Build.VERSION.SDK_INT, canScheduleExact(context));
    }

    /** {@code {allowed, canAsk}}, for the web app's "Allow exact reminders" prompt. */
    static JSObject state(Context context) {
        boolean can = canScheduleExact(context);
        JSObject state = new JSObject();
        state.put("allowed", allowed(Build.VERSION.SDK_INT, can));
        state.put("canAsk", canAsk(Build.VERSION.SDK_INT, can));
        return state;
    }

    /** Android's page for allowing this app's exact alarms (Android 12 and up). */
    static Intent allowPage(Context context) {
        return new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
            .setData(Uri.parse("package:" + context.getPackageName()));
    }

    private static boolean canScheduleExact(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return alarms != null && alarms.canScheduleExactAlarms();
    }
}
