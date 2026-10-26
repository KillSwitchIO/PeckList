package com.killswitch10.punchlist;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.text.format.DateFormat;
import android.webkit.CookieManager;
import com.getcapacitor.Logger;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import org.json.JSONObject;

/**
 * A reminder's alarm going off, and Complete or Snooze pressed on it (Reminders). The buttons act
 * on the server ({@code POST /api/reminders/act}) with the app's session, without opening the app.
 * When that fails (offline, signed out), the notification comes back saying so, and a tap does it
 * in the app instead.
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
                press(app, button, Reminders.Reminder.of(new JSONObject(stored)));
            } catch (Exception error) {
                Logger.warn("Punchlist: reminder button failed: " + error);
            } finally {
                pending.finish();
            }
        }, "punchlist-reminder").start();
    }

    private static void press(Context context, String button, Reminders.Reminder reminder) {
        // Gone from the screen at once, as TickTick does; it comes back only if this fails.
        Reminders.cancelShown(context, reminder.shown());
        int status = act(context, button, reminder);
        if (status == 204) {
            if (Reminders.COMPLETE.equals(button)) {
                Reminders.dropTask(context, reminder.taskId());
            } else {
                Reminders.dropRepeats(context, reminder.tag());
                Reminders.add(context, snoozed(context, reminder));
            }
            return;
        }
        Logger.info("Punchlist", "Reminder " + button + ": the server answered " + status);
        Reminders.show(context, reminder, context.getString(
            Reminders.COMPLETE.equals(button) ? R.string.action_failed_complete : R.string.action_failed_snooze));
    }

    /** The reminder Snooze leaves, until the server's own copy replaces it at the next check-in. */
    private static Reminders.Reminder snoozed(Context context, Reminders.Reminder reminder) {
        long at = (System.currentTimeMillis() / 60_000L + Reminders.SNOOZE_MINUTES) * 60_000L;
        String time = DateFormat.getTimeFormat(context).format(new Date(at));
        return new Reminders.Reminder(reminder.taskId() + "@" + at, reminder.title,
            context.getString(R.string.reminder_body, time), at, reminder.url, false, reminder.repeats);
    }

    /** The server's answer: 204 when done, else why not (0: unreachable). Network: off the main thread. */
    private static int act(Context context, String button, Reminders.Reminder reminder) {
        String server = ServerChoice.get(context);
        String cookie = server == null ? null : CookieManager.getInstance().getCookie(server);
        if (cookie == null) return 0;
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(server + "/api/reminders/act").openConnection();
            try {
                connection.setConnectTimeout(TIMEOUT_MS);
                connection.setReadTimeout(TIMEOUT_MS);
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Cookie", cookie);
                byte[] body = new JSONObject()
                    .put("taskId", reminder.taskId())
                    .put("first", reminder.first())
                    .put("action", button)
                    .put("minutes", Reminders.SNOOZE_MINUTES)
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
            Logger.warn("Punchlist: could not reach " + server + ": " + error.getMessage());
            return 0;
        }
    }
}
