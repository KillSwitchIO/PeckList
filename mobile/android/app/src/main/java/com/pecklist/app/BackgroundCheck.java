package com.pecklist.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.text.format.DateFormat;
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
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.UnaryOperator;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The background check-in (ADR-0017): the WebView has no Web Push, so with the app closed an alarm
 * wakes it every few minutes to ask the server what is new ({@code GET /api/app/check}). New
 * shares, assignments and mentions show as notifications; the reminders ahead are set again, so a
 * reminder changed on another device fires here too. On by default; Settings turns it off or
 * changes how often. Android only lets it run on time when PeckList may run in the background
 * (no battery optimization), which the app asks for once.
 */
final class BackgroundCheck {

    static final String ACTION = "com.pecklist.app.CHECK";
    /**
     * A check-in shortly before a reminder the server set (0.14.0): a task done on another device
     * since the last check-in then takes its reminder off before it comes, a snooze above all, which
     * can come sooner than the next regular check-in.
     */
    static final String BEFORE = "com.pecklist.app.CHECK_BEFORE";
    /** How long before such a reminder that check-in goes. */
    static final long BEFORE_MS = 60_000L;
    /** None sooner than this from now: the reminder, or the regular check-in, is about as near. */
    static final long BEFORE_FLOOR_MS = 20_000L;
    /**
     * Check-ins failed in a row from which it stops until one gets through: one blip should not take
     * them all away, while a server that is down gets no extra request per reminder for long.
     */
    static final int BEFORE_STOPS_AFTER = 3;
    static final int[] CHOICES = {5, 15, 30, 60};
    static final int DEFAULT_MINUTES = 5;

    private static final String PREFS = "pecklist.check";
    private static final String ENABLED = "enabled";
    private static final String MINUTES = "minutes";
    private static final String CURSOR = "cursor";
    private static final String ASKED = "asked";
    private static final String FAILURES = "failures";
    private static final String STOPPED = "stopped";
    /** The longest wait between check-ins after repeated failures. */
    static final int MAX_BACKOFF_MINUTES = 120;
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

    /** Whether Android lets PeckList run in the background on time (no battery optimization). */
    static boolean unrestricted(Context context) {
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return power != null && power.isIgnoringBatteryOptimizations(context.getPackageName());
    }

    static boolean asked(Context context) {
        return prefs(context).getBoolean(ASKED, false);
    }

    static void markAsked(Context context) {
        prefs(context).edit().putBoolean(ASKED, true).apply();
    }

    /**
     * Android's own "let this app always run in the background?" dialog. The Play build may not ask
     * that (no REQUEST_IGNORE_BATTERY_OPTIMIZATIONS): it opens the list of apps instead, where the
     * person picks PeckList and chooses not to optimize it.
     */
    static Intent askToRunInBackground(Context context) {
        Intent intent = new Intent(batteryAction(Distribution.isPlay()));
        return Distribution.isPlay() ? intent : intent.setData(Uri.parse("package:" + context.getPackageName()));
    }

    /**
     * Whether "let it run in the background" opens Android's settings. The foss build asks with
     * Android's own dialog. The Google Play build has only the whole list of apps, which is no
     * question to open unasked: only when the person pressed a button for it (the web app says so
     * from 0.13.0). An older server's web app says nothing either way: its first ask is its
     * first-run prompt, which gets the state instead, and every ask after that is the button.
     */
    static boolean opensSettings(boolean play, boolean pressed, boolean askedBefore) {
        return !play || pressed || askedBefore;
    }

    /** The settings action that lets PeckList run in the background, in each build. */
    static String batteryAction(boolean play) {
        return play
            ? android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS
            : android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS;
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
        prefs(context).edit().remove(CURSOR).remove(FAILURES).remove(STOPPED).apply();
    }

    /**
     * Whether leaving the screen should check in at once: not yet once for this server (installed,
     * cleared, or a server just chosen). The first check-in only notes where things stand, so news
     * between leaving the screen and the first regular one (up to its interval later) was taken as
     * old and never shown (QA's notification drill of 2026-11-20). Checked in as the app leaves,
     * the server's own clock sets the start, and everything after it is news.
     */
    static boolean checksInOnLeaving(String cursor, String server, boolean enabled) {
        return cursor == null && server != null && enabled;
    }

    private static final AtomicBoolean firstCheckRunning = new AtomicBoolean(false);

    /** As the app leaves the screen: the first check-in for this server, now (see checksInOnLeaving). */
    static void checkInOnLeaving(Context context) {
        if (!checksInOnLeaving(prefs(context).getString(CURSOR, null), ServerChoice.get(context), enabled(context))) return;
        // One at a time: leaving and coming back quickly starts no second one alongside.
        if (!firstCheckRunning.compareAndSet(false, true)) return;
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                run(app, true);
            } catch (Exception error) {
                // The regular check-in starts it later, as before.
                Logger.warn("PeckList: first background check failed: " + error);
            } finally {
                firstCheckRunning.set(false);
            }
        }, "pecklist-first-check").start();
    }

    /**
     * Whether an answer's cursor replaces the one kept: only a later one. Two check-ins can overlap
     * (the regular one and the one before a reminder), and the slower one's older cursor would bring
     * back what the other showed (a dismissed notification would come again).
     */
    static boolean laterCursor(String kept, String answered) {
        return answered != null && (kept == null || answered.compareTo(kept) > 0);
    }

    private static synchronized void keepCursor(Context context, String answered) {
        if (laterCursor(prefs(context).getString(CURSOR, null), answered)) {
            prefs(context).edit().putString(CURSOR, answered).commit();
        }
    }

    /**
     * One line per check-in, for the next drill: what it asked after (none: the first, which shows
     * nothing), how many were new, whether they were left to the app on screen, and where it goes
     * on from. The ids are the server's notification ids, nothing about their content.
     */
    static String describe(String after, int fresh, boolean leftToApp, String cursor) {
        return "Background check: after " + (after == null ? "none (first check, nothing shown)" : after)
            + ", " + fresh + " new" + (fresh > 0 && leftToApp ? ", left to the app on screen" : fresh > 0 ? ", shown" : "")
            + ", next after " + (cursor == null ? after : cursor);
    }

    /**
     * Minutes to the next check-in (audit E1): the chosen interval, twice as long after each failure
     * in a row, at most MAX_BACKOFF_MINUTES (never shorter than the interval itself).
     */
    static int delayMinutes(int minutes, int failures) {
        long delay = (long) minutes << Math.min(Math.max(failures, 0), 6);
        return (int) Math.max(minutes, Math.min(delay, MAX_BACKOFF_MINUTES));
    }

    /** The app is open again: a stopped or slowed check-in starts afresh. */
    static void resume(Context context) {
        prefs(context).edit().remove(FAILURES).remove(STOPPED).apply();
        schedule(context);
    }

    private static void failed(Context context) {
        SharedPreferences prefs = prefs(context);
        prefs.edit().putInt(FAILURES, prefs.getInt(FAILURES, 0) + 1).apply();
    }

    /** Set the next check-in, or clear it when there is no server or it is off. */
    static void schedule(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent wake = PendingIntent.getBroadcast(context, 0,
            new Intent(context, CheckReceiver.class).setAction(ACTION),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (alarms == null) return;
        // Signed out (or the account gone): no waking the phone until the app runs again (audit E1).
        if (ServerChoice.get(context) == null || !enabled(context) || prefs(context).getBoolean(STOPPED, false)) {
            alarms.cancel(wake);
            return;
        }
        long at = System.currentTimeMillis() + delayMinutes(minutes(context), prefs(context).getInt(FAILURES, 0)) * 60_000L;
        // Exact, and allowed while the phone is idle, when the app may set exact alarms (ExactAlarms).
        if (ExactAlarms.allowed(context)) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, wake);
        } else {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, wake);
        }
    }

    /**
     * When the check-in before the next reminder goes (see {@link #BEFORE}): {@link #BEFORE_MS} ahead
     * of the soonest reminder that leaves room for it, or -1 for none. Only the server's reminders
     * count: a check-in keeps the ones for tasks the server does not have yet (local), and this
     * phone's quiet copies of a constant reminder are its own.
     */
    static long beforeAt(Collection<Reminders.Reminder> reminders, long now) {
        long soonest = -1;
        for (Reminders.Reminder each : reminders) {
            if (each.local || each.key.endsWith(Reminders.QUIET)) continue;
            long at = each.at - BEFORE_MS;
            if (at < now + BEFORE_FLOOR_MS) continue;
            if (soonest < 0 || at < soonest) soonest = at;
        }
        return soonest;
    }

    /**
     * Set the check-in before the next reminder (the reminders set ahead changed), or clear it: none
     * to come, no server, the check-in off or stopped, or failing {@link #BEFORE_STOPS_AFTER} times in
     * a row (then it would only fail again).
     * Apart from the regular check-in, which keeps its own time.
     */
    static void scheduleBefore(Context context, Collection<Reminders.Reminder> reminders) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent wake = PendingIntent.getBroadcast(context, 1,
            new Intent(context, CheckReceiver.class).setAction(BEFORE),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        SharedPreferences prefs = prefs(context);
        long at = beforeAt(reminders, System.currentTimeMillis());
        if (at < 0 || ServerChoice.get(context) == null || !enabled(context) || prefs.getBoolean(STOPPED, false)
            || prefs.getInt(FAILURES, 0) >= BEFORE_STOPS_AFTER) {
            alarms.cancel(wake);
            return;
        }
        if (ExactAlarms.allowed(context)) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, wake);
        } else {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, wake);
        }
    }

    /**
     * Whether an answer's reminders replace the phone's alarms: only when the check asked for them
     * (the app was off screen as it went) and the app is still off screen (else the web app owns
     * them). An answer to a check that asked for none has none, and would wipe every alarm.
     */
    static boolean handsOverReminders(boolean showingWhenAsked, boolean showingNow) {
        return !showingWhenAsked && !showingNow;
    }

    /**
     * The check-in's address. With the app on screen the web app owns the reminders and the answer's
     * would go unused, so it asks for none: the server then skips walking every task for them
     * (audit P7). A server from before that sends them anyway, and they are left as before.
     * {@code clock24}: the phone's own 12/24-hour setting, which an automatic clock follows on the
     * phone (schema 22), so the server words the reminders it hands back on it (Dev 1, S3).
     */
    static String checkAddress(
        String server, String zone, String after, boolean showing, boolean clock24, UnaryOperator<String> encode
    ) {
        return server + "/api/app/check?zone=" + encode.apply(zone)
            + (after == null ? "" : "&after=" + encode.apply(after))
            + (showing ? "&reminders=0" : "")
            + "&clock24=" + (clock24 ? "1" : "0");
    }

    /** One check-in. Network: call off the main thread. Signed out or offline, it waits for the next. */
    static void run(Context context) throws Exception {
        run(context, false);
    }

    /**
     * Whether a refused check-in (401, 403) stops them until the app runs again. Not the one as the
     * app leaves: right after a server is chosen, the WebView may still hold an old session's cookie
     * while the person signs in (in the browser, which also leaves the screen), and that sign-in
     * comes back without a fresh start, which alone would set them going again (Dev 1's review).
     */
    static boolean stopsWhenRefused(boolean leaving) {
        return !leaving;
    }

    private static void run(Context context, boolean leaving) throws Exception {
        String server = ServerChoice.get(context);
        if (server == null || !enabled(context)) return;
        CookieManager cookies = CookieManager.getInstance();
        String cookie = cookies.getCookie(server);
        if (cookie == null) return;
        // Presses made offline first, so the reminders that come back already reflect them.
        ReminderReceiver.retryPending(context);
        Widgets.sendDue(context);
        String after = prefs(context).getString(CURSOR, null);
        // Read once: the answer's reminders are what this request asked for (audit P7).
        boolean showing = MainActivity.showing();
        String address = checkAddress(
            server, TimeZone.getDefault().getID(), after, showing, DateFormat.is24HourFormat(context), Uri::encode
        );

        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        ClientCert.apply(context, connection);
        JSONObject answer;
        try {
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("Accept", "application/json");
            // The reminders' text in the app's language: the server follows settings.language, and
            // this for automatic (PL-148).
            connection.setRequestProperty("Accept-Language", Languages.acceptLanguage(context));
            int status;
            try {
                status = connection.getResponseCode();
            } catch (IOException error) {
                failed(context);
                throw error;
            }
            if (status == 401 || status == 403) {
                if (!stopsWhenRefused(leaving)) {
                    Logger.info("PeckList", "Background check: not signed in yet (" + status + "); the regular check-in goes on");
                    return;
                }
                // The session is over: stop until the app is opened again.
                Logger.info("PeckList", "Background check: signed out (" + status + "); stopped until the app runs");
                prefs(context).edit().putBoolean(STOPPED, true).apply();
                return;
            }
            if (status != 200) {
                Logger.info("PeckList", "Background check: the server answered " + status);
                failed(context);
                return;
            }
            if (InstalledCa.reliedOn(connection) && !ServerChoice.installedCaAgreed(context, server)) {
                // Someone else's authority vouches for the server now: nothing is used, and the
                // app asks at its next start (audit A2).
                Logger.warn("PeckList", "Background check: the server's certificate comes from an installed authority; stopped");
                prefs(context).edit().putBoolean(STOPPED, true).apply();
                return;
            }
            prefs(context).edit().remove(FAILURES).apply();
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
        boolean showingNow = MainActivity.showing();
        if (handsOverReminders(showing, showingNow)) {
            Reminders.handOver(context, Reminders.parse(answer.getJSONArray("reminders")), true);
        }
        JSONArray fresh = answer.getJSONArray("notifications");
        if (!showingNow) Reminders.showNew(context, fresh);
        String cursor = answer.isNull("cursor") ? null : answer.getString("cursor");
        keepCursor(context, cursor);
        Logger.info("PeckList", describe(after, fresh.length(), showingNow, cursor));
        Widgets.redraw(context);
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
