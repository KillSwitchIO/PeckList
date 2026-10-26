package com.killswitch10.punchlist;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.webkit.CookieManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONObject;

/**
 * The background check-in (ADR-0017): the WebView has no Web Push, so with the app closed an alarm
 * wakes it every few minutes to ask the server what is new ({@code GET /api/app/check}). New
 * shares, assignments and mentions show as notifications; the reminders ahead are set again, so a
 * reminder changed on another device fires here too. On by default; Settings turns it off or
 * changes how often. Android only lets it run on time when Punchlist may run in the background
 * (no battery optimization), which the app asks for once.
 */
final class BackgroundCheck {

    static final String ACTION = "com.killswitch10.punchlist.CHECK";
    static final int[] CHOICES = {5, 15, 30, 60};
    static final int DEFAULT_MINUTES = 5;

    private static final String PREFS = "punchlist.check";
    private static final String ENABLED = "enabled";
    private static final String MINUTES = "minutes";
    private static final String CURSOR = "cursor";
    private static final String ASKED = "asked";
    private static final int TIMEOUT_MS = 15000;

    private BackgroundCheck() {}

    static boolean enabled(Context context) {
        return prefs(context).getBoolean(ENABLED, true);
    }

    static int minutes(Context context) {
        int minutes = prefs(context).getInt(MINUTES, DEFAULT_MINUTES);
        for (int choice : CHOICES) if (choice == minutes) return minutes;
        return DEFAULT_MINUTES;
    }

    /** Turn it on or off, or change how often; null leaves that as it is. */
    static void change(Context context, Boolean enabled, Integer minutes) {
        SharedPreferences.Editor edit = prefs(context).edit();
        if (enabled != null) edit.putBoolean(ENABLED, enabled);
        if (minutes != null) {
            for (int choice : CHOICES) if (choice == minutes) edit.putInt(MINUTES, minutes);
        }
        edit.commit();
        schedule(context);
    }

    /** Whether Android lets Punchlist run in the background on time (no battery optimization). */
    static boolean unrestricted(Context context) {
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return power != null && power.isIgnoringBatteryOptimizations(context.getPackageName());
    }

    static void markAsked(Context context) {
        prefs(context).edit().putBoolean(ASKED, true).apply();
    }

    /** Android's own "let this app always run in the background?" dialog. */
    static Intent askToRunInBackground(Context context) {
        return new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:" + context.getPackageName()));
    }

    static JSObject state(Context context) {
        JSObject state = new JSObject();
        state.put("enabled", enabled(context));
        state.put("minutes", minutes(context));
        JSArray choices = new JSArray();
        for (int choice : CHOICES) choices.put(choice);
        state.put("choices", choices);
        state.put("unrestricted", unrestricted(context));
        state.put("asked", prefs(context).getBoolean(ASKED, false));
        // Some makers (Samsung) put apps to sleep on top of Android; the app says where to stop that.
        state.put("maker", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.ROOT));
        return state;
    }

    /** A new server, or none: what was new on the old one means nothing here. */
    static void forgetServer(Context context) {
        prefs(context).edit().remove(CURSOR).apply();
    }

    /** Set the next check-in, or clear it when there is no server or it is off. */
    static void schedule(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent wake = PendingIntent.getBroadcast(context, 0,
            new Intent(context, CheckReceiver.class).setAction(ACTION),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (alarms == null) return;
        if (ServerChoice.get(context) == null || !enabled(context)) {
            alarms.cancel(wake);
            return;
        }
        long at = System.currentTimeMillis() + minutes(context) * 60_000L;
        // Exact, and allowed while the phone is idle: the app has exact alarms for its reminders.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, wake);
        } else {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, wake);
        }
    }

    /** One check-in. Network: call off the main thread. Signed out or offline, it waits for the next. */
    static void run(Context context) throws Exception {
        String server = ServerChoice.get(context);
        if (server == null || !enabled(context)) return;
        CookieManager cookies = CookieManager.getInstance();
        String cookie = cookies.getCookie(server);
        if (cookie == null) return;
        String after = prefs(context).getString(CURSOR, null);
        String address = server + "/api/app/check?zone=" + Uri.encode(TimeZone.getDefault().getID())
            + (after == null ? "" : "&after=" + Uri.encode(after));

        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        JSONObject answer;
        try {
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status != 200) {
                Logger.info("Punchlist", "Background check: the server answered " + status);
                return;
            }
            // The session slides forward on use: keep the renewed cookie, as the WebView would.
            List<String> renewed = connection.getHeaderFields().get("Set-Cookie");
            if (renewed != null) {
                for (String each : renewed) cookies.setCookie(server, each);
                cookies.flush();
            }
            answer = new JSONObject(read(connection.getInputStream()));
        } finally {
            connection.disconnect();
        }

        // With the app on screen, the web app shows what is new and owns the reminders.
        if (!MainActivity.showing()) {
            Reminders.handOver(context, Reminders.parse(answer.getJSONArray("reminders")));
            Reminders.showNew(context, answer.getJSONArray("notifications"));
        }
        if (!answer.isNull("cursor")) prefs(context).edit().putString(CURSOR, answer.getString("cursor")).apply();
    }

    private static String read(InputStream stream) throws IOException {
        try (InputStream in = stream) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int count; (count = in.read(buffer)) != -1; ) out.write(buffer, 0, count);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
