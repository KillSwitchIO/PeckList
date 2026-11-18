package com.pecklist.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.webkit.CookieManager;
import com.getcapacitor.Logger;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * A reminder's alarm going off, and Complete or Snooze pressed on it (Reminders). Neither opens
 * the app: on a server the buttons act there ({@code POST /api/reminders/act}) with the app's
 * session, and are sent again later when it cannot be reached (Pending); standalone, or on a server
 * too old to move a repeating task, the web app finishes them the next time it runs (Held).
 */
public class ReminderReceiver extends BroadcastReceiver {

    private static final int TIMEOUT_MS = 10000;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Reminders.FIRE.equals(action)) {
            String key = intent.getStringExtra("key");
            if (key != null) Reminders.fire(context, key);
            return;
        }
        String button = action != null && action.endsWith("." + Reminders.COMPLETE) ? Reminders.COMPLETE
            : action != null && action.endsWith("." + Reminders.SNOOZE) ? Reminders.SNOOZE : null;
        String stored = intent.getStringExtra(Reminders.EXTRA_REMINDER);
        if (button == null || stored == null) return;
        PendingResult pending = goAsync();
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                press(app, button, Reminders.Reminder.of(new JSONObject(stored)), Reminders.SNOOZE_MINUTES);
            } catch (Exception error) {
                Logger.warn("PeckList: reminder button failed: " + error);
            } finally {
                pending.finish();
            }
        }, "pecklist-reminder").start();
    }

    /** Complete, or Snooze for {@code minutes}, pressed now. Network: call off the main thread. */
    static void press(Context context, String button, Reminders.Reminder reminder, int minutes) {
        press(context, button, reminder, minutes, System.currentTimeMillis());
    }

    /**
     * Complete, or Snooze for {@code minutes} from {@code pressedAt}: a slow network or a retry
     * never moves when it comes back. Network: call off the main thread.
     */
    static void press(Context context, String button, Reminders.Reminder reminder, int minutes, long pressedAt) {
        // Gone from the screen at once, as TickTick does; it comes back only if this fails.
        Reminders.cancelShown(context, reminder.shown());
        // Done here at once, offline too: the server hears of it now or at the next check-in.
        if (Reminders.COMPLETE.equals(button)) {
            Reminders.dropTask(context, reminder.taskId());
        } else {
            Reminders.dropRepeats(context, reminder.tag());
            Reminders.add(context, snoozed(context, reminder, minutes, pressedAt));
        }
        if (ServerChoice.get(context) == null) {
            Held.add(context, button, reminder.taskId(), minutes, pressedAt);
            return;
        }
        // The server counts from when it hears: tell it what is left of the snooze by then.
        int send = Reminders.SNOOZE.equals(button)
            ? Math.max(1, SnoozeTimes.left(minutes, pressedAt, System.currentTimeMillis())) : minutes;
        int status = act(context, button, reminder, send);
        if (status == 204) return;
        if (status == 409) {
            // A server from before it moved repeating tasks itself: the app moves it.
            Held.add(context, button, reminder.taskId(), minutes, pressedAt);
            return;
        }
        Logger.info("PeckList", "Reminder " + button + ": the server answered " + status + "; trying again later");
        // Unreachable or signed out: later. Refused (the task is gone, or not theirs): nothing to do.
        if (status == 0 || status == 401 || status == 403 || status >= 500) {
            Pending.add(context, button, reminder.taskId(), reminder.first(), minutes, pressedAt);
        }
    }

    /** Presses the server did not hear of yet, sent again. Network: call off the main thread. */
    static void retryPending(Context context) {
        boolean reachable = true;
        for (Pending.Press each : Pending.take(context)) {
            // A snooze comes back when the person chose, however late the server hears of it; once
            // that has passed, the phone has shown it again and there is nothing left to tell.
            int minutes = Reminders.SNOOZE.equals(each.button)
                ? SnoozeTimes.left(each.minutes, each.at, System.currentTimeMillis()) : each.minutes;
            if (Reminders.SNOOZE.equals(each.button) && minutes == 0) continue;
            // Once the server cannot be reached, the rest wait too.
            int status = reachable ? act(context, each.button, each.taskId, each.first, minutes) : 0;
            if (status == 409) {
                Held.add(context, each.button, each.taskId, minutes);
                continue;
            }
            if (status == 0 || status == 401 || status == 403 || status >= 500) {
                reachable = false;
                Pending.add(context, each.button, each.taskId, each.first, each.minutes, each.at);
            }
        }
    }

    /** The reminder Snooze leaves, until the server's own copy replaces it at the next check-in. */
    private static Reminders.Reminder snoozed(Context context, Reminders.Reminder reminder, int minutes, long pressedAt) {
        long at = SnoozeTimes.until(pressedAt, minutes);
        // The day too when it is not today (a snooze until tomorrow, or a date picked).
        String time = SnoozeActivity.when(context, at);
        return new Reminders.Reminder(reminder.taskId() + "@" + at, reminder.title,
            context.getString(R.string.reminder_body, time), at, reminder.url, false, reminder.repeats);
    }

    /** The server's answer: 204 when done, else why not (0: unreachable). Network: off the main thread. */
    private static int act(Context context, String button, Reminders.Reminder reminder, int minutes) {
        return act(context, button, reminder.taskId(), reminder.first(), minutes);
    }

    private static int act(Context context, String button, String taskId, long first, int minutes) {
        String server = ServerChoice.get(context);
        String cookie = server == null ? null : CookieManager.getInstance().getCookie(server);
        if (cookie == null) return 0;
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(server + "/api/reminders/act").openConnection();
            ClientCert.apply(context, connection);
            try {
                connection.setConnectTimeout(TIMEOUT_MS);
                connection.setReadTimeout(TIMEOUT_MS);
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Cookie", cookie);
                byte[] body = new JSONObject()
                    .put("taskId", taskId)
                    .put("first", first)
                    .put("action", button)
                    .put("minutes", minutes)
                    .toString()
                    .getBytes(StandardCharsets.UTF_8);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body);
                }
                return connection.getResponseCode();
            } finally {
                connection.disconnect();
            }
        } catch (Exception error) {
            Logger.warn("PeckList: could not reach " + server + ": " + error.getMessage());
            return 0;
        }
    }
}
