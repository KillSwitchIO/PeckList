package com.killswitch10.punchlist;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import com.capacitorjs.plugins.localnotifications.LocalNotification;
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager;
import com.capacitorjs.plugins.localnotifications.LocalNotificationSchedule;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher;
import com.getcapacitor.CapConfig;
import com.getcapacitor.JSObject;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Notifications from the background check-in, through the same Local Notifications store the web
 * app hands its reminders to (web/src/adapters/capacitor-notifier.ts), with the same ids and
 * fields. So either side can set the reminders ahead, a reminder set by both is one, and a tap
 * opens the task through the web app's own handler. This leans on the plugin's Kotlin classes,
 * which is why its version is pinned exactly in mobile/package.json.
 */
final class NativeReminders {

    /** The channels: reminders (the web app names it too), and what is new from other people. */
    static final String REMINDERS = "reminders";
    static final String ACTIVITY = "activity";

    private NativeReminders() {}

    /** The id for a key, as the web app's idOf() makes it: String.hashCode() is its hash. */
    static int idOf(String key) {
        return (int) (Math.abs((long) key.hashCode()) % 1_000_000_000L) + 1;
    }

    /** Replace the reminders set ahead with these ({tag, title, body, at, url} from the server). */
    static void handOver(Context context, JSONArray reminders) throws JSONException, ParseException {
        channel(context, REMINDERS, R.string.channel_reminders);
        NotificationStorage storage = new NotificationStorage(context);
        Map<Integer, JSObject> wanted = new LinkedHashMap<>();
        for (int i = 0; i < reminders.length(); i++) {
            JSONObject each = reminders.getJSONObject(i);
            String tag = each.getString("tag");
            JSObject schedule = new JSObject();
            schedule.put("at", jsDate(each.getLong("at")));
            schedule.put("allowWhileIdle", true);
            JSObject notification = notification(idOf(tag), each, REMINDERS, tag);
            notification.put("schedule", schedule);
            wanted.put(idOf(tag), notification);
        }
        for (LocalNotification saved : storage.getSavedNotifications()) {
            Integer id = saved.getId();
            if (id == null || saved.getSchedule() == null || saved.isTriggered() || wanted.containsKey(id)) continue;
            cancelAlarm(context, id);
            storage.deleteNotification(String.valueOf(id));
        }
        // Only what changed: setting one again would also clear it from the shade.
        List<LocalNotification> changed = new ArrayList<>();
        for (Map.Entry<Integer, JSObject> entry : wanted.entrySet()) {
            LocalNotification saved = storage.getSavedNotification(String.valueOf(entry.getKey()));
            String source = entry.getValue().toString();
            if (saved != null && source.equals(saved.getSource())) continue;
            changed.add(LocalNotification.Companion.buildNotificationFromJSObject(entry.getValue()));
        }
        if (!changed.isEmpty() && manager(context, storage).schedule(null, changed) != null) {
            storage.appendNotifications(changed);
        }
    }

    /** Show what is new ({id, title, body, url} from the server) now. */
    static void showNew(Context context, JSONArray notifications) throws JSONException, ParseException {
        if (notifications.length() == 0) return;
        channel(context, ACTIVITY, R.string.channel_activity);
        List<LocalNotification> shown = new ArrayList<>();
        for (int i = 0; i < notifications.length(); i++) {
            JSONObject each = notifications.getJSONObject(i);
            String tag = "news:" + each.getString("id");
            shown.add(LocalNotification.Companion.buildNotificationFromJSObject(notification(idOf(tag), each, ACTIVITY, tag)));
        }
        manager(context, new NotificationStorage(context)).schedule(null, shown);
    }

    private static JSObject notification(int id, JSONObject from, String channel, String tag) throws JSONException {
        JSObject extra = new JSObject();
        extra.put("url", from.getString("url"));
        extra.put("tag", tag);
        JSObject notification = new JSObject();
        notification.put("id", id);
        notification.put("title", from.getString("title"));
        notification.put("body", from.getString("body"));
        notification.put("channelId", channel);
        notification.put("extra", extra);
        return notification;
    }

    private static LocalNotificationManager manager(Context context, NotificationStorage storage) {
        // No activity here: a tap opens the app's launch screen, where the plugin reports it.
        return new LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context));
    }

    /** The plugin's own way to clear an alarm (LocalNotificationManager.cancelTimerForNotification). */
    private static void cancelAlarm(Context context, int id) {
        PendingIntent alarm = PendingIntent.getBroadcast(context, id, new Intent(context, TimedNotificationPublisher.class),
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_MUTABLE);
        if (alarm == null) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(alarm);
        alarm.cancel();
    }

    /** The web app makes the reminders channel with its own name; the app may not have run yet. */
    private static void channel(Context context, String id, int name) {
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        if (notifications == null || notifications.getNotificationChannel(id) != null) return;
        notifications.createNotificationChannel(
            new NotificationChannel(id, context.getString(name), NotificationManager.IMPORTANCE_HIGH));
    }

    private static String jsDate(long at) {
        SimpleDateFormat format = new SimpleDateFormat(LocalNotificationSchedule.JS_DATE_FORMAT, Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(at));
    }
}
