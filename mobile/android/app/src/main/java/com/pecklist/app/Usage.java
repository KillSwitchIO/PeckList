package com.pecklist.app;

import android.app.ActivityManager;
import android.app.AlarmManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.PowerManager;
import androidx.core.app.NotificationManagerCompat;
import java.io.InputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What the shell counts for the usage report (PL-116) and the crashes it notices, kept until the
 * web app asks: how late reminders fired, the permissions reminders need, and the last crash or
 * ANR. The web app sends counts only when the server reports and the person shares, and offers a
 * crash report the person sees first; nothing leaves the phone from here.
 */
final class Usage {
    private static final String PREFS = "pecklist-usage";
    private static final String COUNTS = "counts";
    private static final String CRASH = "crash";
    private static final String EXITS_SEEN = "exits-seen";
    private static final int MAX_STACK = 8 * 1024;

    private Usage() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Count one of a name the server knows (see ClientUsage.Features). */
    static synchronized void count(Context context, String name) {
        SharedPreferences prefs = prefs(context);
        try {
            JSONObject counts = new JSONObject(prefs.getString(COUNTS, "{}"));
            counts.put(name, counts.optInt(name, 0) + 1);
            prefs.edit().putString(COUNTS, counts.toString()).apply();
        } catch (JSONException error) {
            prefs.edit().remove(COUNTS).apply();
        }
    }

    /** A reminder showed: how late, against when it was due (the single most useful number for 1.0). */
    static void delivered(Context context, long dueAt) {
        long late = System.currentTimeMillis() - dueAt;
        String name = late <= 15_000 ? "reminder.onTime"
            : late < 60_000 ? "reminder.late1m"
            : late < 5 * 60_000 ? "reminder.late5m"
            : "reminder.lateMore";
        count(context, name);
    }

    /** The counts since the web app last asked, which starts them afresh. */
    static synchronized JSONObject takeCounts(Context context) {
        SharedPreferences prefs = prefs(context);
        JSONObject counts;
        try {
            counts = new JSONObject(prefs.getString(COUNTS, "{}"));
        } catch (JSONException error) {
            counts = new JSONObject();
        }
        prefs.edit().remove(COUNTS).apply();
        return counts;
    }

    /** Whether reminders can work: notifications allowed, exact alarms allowed, and no battery limits. */
    static JSONObject permissions(Context context) throws JSONException {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || (alarms != null && alarms.canScheduleExactAlarms());
        boolean battery = power != null && power.isIgnoringBatteryOptimizations(context.getPackageName());
        return new JSONObject()
            .put("notify", NotificationManagerCompat.from(context).areNotificationsEnabled() ? "on" : "off")
            .put("exact", exact ? "on" : "off")
            .put("battery", battery ? "on" : "off");
    }

    /** Keep a Java crash for the next start (the app goes down right after). */
    static void watchForCrashes(Context context) {
        Context app = context.getApplicationContext();
        Thread.UncaughtExceptionHandler before = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                StringWriter stack = new StringWriter();
                error.printStackTrace(new PrintWriter(stack));
                JSONObject crash = new JSONObject()
                    .put("kind", error.getClass().getSimpleName())
                    .put("stack", cut(stack.toString()));
                // commit, not apply: the process ends next.
                prefs(app).edit().putString(CRASH, crash.toString()).commit();
            } catch (Exception ignored) {
                // Keeping the report must never stand in the way of the crash itself.
            }
            if (before != null) before.uncaughtException(thread, error);
        });
    }

    /**
     * The crash to offer a report for, if the app went down since the last look: a Java crash it
     * kept, or (Android 11 and later) a native crash or an ANR the system recorded. Asking uses it up.
     */
    static synchronized JSONObject takeCrash(Context context) {
        SharedPreferences prefs = prefs(context);
        String kept = prefs.getString(CRASH, null);
        long seen = prefs.getLong(EXITS_SEEN, 0);
        prefs.edit().remove(CRASH).putLong(EXITS_SEEN, System.currentTimeMillis()).apply();
        if (kept != null) {
            try {
                return new JSONObject(kept);
            } catch (JSONException ignored) {
                // Fall through to what the system recorded.
            }
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || seen == 0) return null;
        ActivityManager activities = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (activities == null) return null;
        List<ApplicationExitInfo> exits = activities.getHistoricalProcessExitReasons(context.getPackageName(), 0, 5);
        for (ApplicationExitInfo exit : exits) {
            if (exit.getTimestamp() <= seen) continue;
            int reason = exit.getReason();
            if (reason != ApplicationExitInfo.REASON_ANR && reason != ApplicationExitInfo.REASON_CRASH_NATIVE) continue;
            try {
                String trace = "";
                try (InputStream in = exit.getTraceInputStream()) {
                    if (in != null) trace = new String(readSome(in), StandardCharsets.UTF_8);
                }
                String description = exit.getDescription() == null ? "" : exit.getDescription();
                return new JSONObject()
                    .put("kind", reason == ApplicationExitInfo.REASON_ANR ? "ANR" : "NativeCrash")
                    .put("stack", cut(description + "\n" + trace));
            } catch (Exception ignored) {
                return null;
            }
        }
        return null;
    }

    private static byte[] readSome(InputStream in) throws java.io.IOException {
        byte[] buffer = new byte[MAX_STACK];
        int total = 0;
        for (int read; total < buffer.length && (read = in.read(buffer, total, buffer.length - total)) != -1; ) total += read;
        return java.util.Arrays.copyOf(buffer, total);
    }

    private static String cut(String text) {
        return text.length() > MAX_STACK ? text.substring(0, MAX_STACK) : text;
    }

    /** For the plugin: counts as a plain map of name to number. */
    static JSONObject countsOnly(JSONObject counts) throws JSONException {
        JSONObject out = new JSONObject();
        for (Iterator<String> names = counts.keys(); names.hasNext(); ) {
            String name = names.next();
            out.put(name, counts.optInt(name, 0));
        }
        return out;
    }
}
