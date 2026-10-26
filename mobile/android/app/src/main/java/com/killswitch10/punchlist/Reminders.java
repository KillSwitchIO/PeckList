package com.killswitch10.punchlist;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.capacitorjs.plugins.localnotifications.LocalNotification;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The app's own reminders (ADR-0017): set ahead as exact alarms, by the web app while it is open and
 * by the background check-in while it is closed, and shown when they fire with Complete and Snooze,
 * as TickTick's are. A tap opens the task. Both sides key a reminder the same way (taskId@first,
 * #n on a constant reminder's repeats; web/src/core/reminders.ts), and each hand-over replaces the
 * last, so a reminder set by both is one.
 */
final class Reminders {

    static final String CHANNEL = "reminders";
    static final String ACTIVITY = "activity";
    /** How long Snooze puts a reminder off (the web app's SNOOZE_MINUTES). */
    static final int SNOOZE_MINUTES = 10;

    static final String FIRE = "com.killswitch10.punchlist.REMINDER";
    static final String COMPLETE = "complete";
    static final String SNOOZE = "snooze";

    /** Intent extras for the app: where to go, and a button to finish there (MainActivity, ShellPlugin). */
    static final String EXTRA_URL = "punchlist.url";
    static final String EXTRA_ACTION = "punchlist.action";
    static final String EXTRA_TASK = "punchlist.task";
    static final String EXTRA_MINUTES = "punchlist.minutes";
    static final String EXTRA_SHOWN = "punchlist.shown";
    static final String EXTRA_REMINDER = "punchlist.reminder";

    private static final String PREFS = "punchlist.reminders";
    private static final String ALL = "all";
    private static final String MIGRATED = "migrated-from-plugin";

    private Reminders() {}

    /** One reminder: {key, title, body, at, url, constant, repeats}. */
    static final class Reminder {
        final String key;
        final String title;
        final String body;
        final long at;
        final String url;
        final boolean constant;
        final boolean repeats;

        Reminder(String key, String title, String body, long at, String url, boolean constant, boolean repeats) {
            this.key = key;
            this.title = title;
            this.body = body;
            this.at = at;
            this.url = url;
            this.constant = constant;
            this.repeats = repeats;
        }

        static Reminder of(JSONObject json) throws JSONException {
            return new Reminder(
                json.has("key") ? json.getString("key") : json.getString("tag"),
                json.getString("title"),
                json.getString("body"),
                json.getLong("at"),
                json.getString("url"),
                json.optBoolean("constant", false),
                json.optBoolean("repeats", false)
            );
        }

        JSONObject json() throws JSONException {
            return new JSONObject()
                .put("key", key)
                .put("title", title)
                .put("body", body)
                .put("at", at)
                .put("url", url)
                .put("constant", constant)
                .put("repeats", repeats);
        }

        /** What a constant reminder's repeats share: each replaces the last on screen. */
        String tag() {
            int hash = key.indexOf('#');
            return hash < 0 ? key : key.substring(0, hash);
        }

        String taskId() {
            String tag = tag();
            int at = tag.lastIndexOf('@');
            return at < 0 ? tag : tag.substring(0, at);
        }

        long first() {
            String tag = tag();
            try {
                return Long.parseLong(tag.substring(tag.lastIndexOf('@') + 1));
            } catch (NumberFormatException error) {
                return at;
            }
        }

        int alarm() {
            return idOf(key);
        }

        int shown() {
            return idOf(tag());
        }
    }

    /** An id for a key, as the web app's idOf() makes it: String.hashCode() is its hash. */
    static int idOf(String key) {
        return (int) (Math.abs((long) key.hashCode()) % 1_000_000_000L) + 1;
    }

    static List<Reminder> parse(JSONArray array) throws JSONException {
        List<Reminder> all = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) all.add(Reminder.of(array.getJSONObject(i)));
        return all;
    }

    /** Replace the reminders set ahead with these. */
    static synchronized void handOver(Context context, List<Reminder> wanted) {
        migrateFromPlugin(context);
        Map<String, Reminder> next = new LinkedHashMap<>();
        for (Reminder each : wanted) next.put(each.key, each);
        for (Reminder old : load(context).values()) {
            if (!next.containsKey(old.key)) cancelAlarm(context, old);
        }
        long now = System.currentTimeMillis();
        for (Reminder each : next.values()) if (each.at > now) setAlarm(context, each);
        save(context, next);
    }

    /** After a restart or an update, which clear alarms. */
    static synchronized void restore(Context context) {
        long now = System.currentTimeMillis();
        for (Reminder each : load(context).values()) if (each.at > now) setAlarm(context, each);
    }

    /** An alarm went off: show its reminder, once. */
    static synchronized void fire(Context context, String key) {
        Map<String, Reminder> all = load(context);
        Reminder due = all.remove(key);
        if (due == null) return;
        save(context, all);
        show(context, due);
    }

    /** Forget a task's reminders still to come (it was completed from a notification). */
    static synchronized void dropTask(Context context, String taskId) {
        Map<String, Reminder> all = load(context);
        all.values().removeIf((each) -> {
            boolean gone = each.taskId().equals(taskId);
            if (gone) cancelAlarm(context, each);
            return gone;
        });
        save(context, all);
    }

    /** Forget the rest of a constant reminder's repeats (it was snoozed). */
    static synchronized void dropRepeats(Context context, String tag) {
        Map<String, Reminder> all = load(context);
        all.values().removeIf((each) -> {
            boolean gone = each.tag().equals(tag);
            if (gone) cancelAlarm(context, each);
            return gone;
        });
        save(context, all);
    }

    /** Add one reminder now (a snooze done here, before the server's copy comes back). */
    static synchronized void add(Context context, Reminder reminder) {
        Map<String, Reminder> all = load(context);
        all.put(reminder.key, reminder);
        save(context, all);
        setAlarm(context, reminder);
    }

    /**
     * Show a reminder with Complete and Snooze. On a server they act there without opening the app;
     * standalone, or for a repeating task (only the app works out its next date), they open the app
     * to do it. Snooze asks how long first.
     */
    static void show(Context context, Reminder reminder) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return;
        channel(context, CHANNEL, R.string.channel_reminders, NotificationManager.IMPORTANCE_HIGH);
        boolean onServer = ServerChoice.get(context) != null;
        NotificationCompat.Builder built = base(context, CHANNEL, reminder.title, reminder.body)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setWhen(reminder.at)
            .setContentIntent(open(context, reminder, null))
            .addAction(0, context.getString(R.string.action_complete),
                onServer && !reminder.repeats ? act(context, reminder, COMPLETE) : open(context, reminder, COMPLETE))
            .addAction(0, context.getString(R.string.action_snooze), snoozePicker(context, reminder));
        NotificationManagerCompat.from(context).notify(reminder.shown(), built.build());
    }

    /** What is new from other people ({id, title, body, url} from the check-in), shown now. */
    static void showNew(Context context, JSONArray notifications) throws JSONException {
        if (notifications.length() == 0 || !NotificationManagerCompat.from(context).areNotificationsEnabled()) return;
        channel(context, ACTIVITY, R.string.channel_activity, NotificationManager.IMPORTANCE_DEFAULT);
        for (int i = 0; i < notifications.length(); i++) {
            JSONObject each = notifications.getJSONObject(i);
            int id = idOf("news:" + each.getString("id"));
            Intent intent = new Intent(context, MainActivity.class)
                .setAction("com.killswitch10.punchlist.OPEN." + id)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_URL, each.getString("url"))
                .putExtra(EXTRA_SHOWN, id);
            NotificationCompat.Builder built = base(context, ACTIVITY, each.getString("title"), each.getString("body"))
                .setCategory(NotificationCompat.CATEGORY_SOCIAL)
                .setContentIntent(PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            NotificationManagerCompat.from(context).notify(id, built.build());
        }
    }

    static void cancelShown(Context context, int id) {
        NotificationManagerCompat.from(context).cancel(id);
    }

    private static NotificationCompat.Builder base(Context context, String channel, String title, String text) {
        return new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_punchlist)
            .setColor(ContextCompat.getColor(context, R.color.notification_accent))
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true);
    }

    /** Opens the app on the reminder's task, and with a button, finishes it there. */
    private static PendingIntent open(Context context, Reminder reminder, String action) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction("com.killswitch10.punchlist.OPEN." + (action == null ? "" : action))
            .setData(Uri.parse("punchlist-reminder://" + reminder.alarm()))
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_URL, reminder.url)
            .putExtra(EXTRA_SHOWN, reminder.shown());
        if (action != null) {
            intent.putExtra(EXTRA_ACTION, action).putExtra(EXTRA_TASK, reminder.taskId()).putExtra(EXTRA_MINUTES, SNOOZE_MINUTES);
        }
        return PendingIntent.getActivity(context, reminder.alarm(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Snooze asks how long first, as TickTick does (SnoozeActivity, a dialog over whatever is on screen). */
    private static PendingIntent snoozePicker(Context context, Reminder reminder) {
        Intent intent = new Intent(context, SnoozeActivity.class)
            .setData(Uri.parse("punchlist-reminder://" + reminder.alarm()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        try {
            intent.putExtra(EXTRA_REMINDER, reminder.json().toString());
        } catch (JSONException error) {
            throw new IllegalStateException(error);
        }
        return PendingIntent.getActivity(context, reminder.alarm(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Opens the app on the task to snooze it there (standalone, or the server could not be reached). */
    static Intent snoozeInApp(Context context, Reminder reminder, int minutes) {
        return new Intent(context, MainActivity.class)
            .setAction("com.killswitch10.punchlist.OPEN." + SNOOZE)
            .setData(Uri.parse("punchlist-reminder://" + reminder.alarm()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_URL, reminder.url)
            .putExtra(EXTRA_SHOWN, reminder.shown())
            .putExtra(EXTRA_ACTION, SNOOZE)
            .putExtra(EXTRA_TASK, reminder.taskId())
            .putExtra(EXTRA_MINUTES, minutes);
    }

    /** Acts on the server without opening the app (ReminderReceiver). */
    private static PendingIntent act(Context context, Reminder reminder, String action) {
        Intent intent = new Intent(context, ReminderReceiver.class)
            .setAction("com.killswitch10.punchlist." + action)
            .setData(Uri.parse("punchlist-reminder://" + reminder.alarm()));
        try {
            intent.putExtra(EXTRA_REMINDER, reminder.json().toString());
        } catch (JSONException error) {
            throw new IllegalStateException(error);
        }
        return PendingIntent.getBroadcast(context, reminder.alarm(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent alarmIntent(Context context, Reminder reminder, int flags) {
        Intent intent = new Intent(context, ReminderReceiver.class)
            .setAction(FIRE)
            .setData(Uri.parse("punchlist-reminder://" + reminder.alarm()))
            .putExtra("key", reminder.key);
        return PendingIntent.getBroadcast(context, reminder.alarm(), intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void setAlarm(Context context, Reminder reminder) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent wake = alarmIntent(context, reminder, PendingIntent.FLAG_UPDATE_CURRENT);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminder.at, wake);
        } else {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminder.at, wake);
        }
    }

    private static void cancelAlarm(Context context, Reminder reminder) {
        PendingIntent wake = alarmIntent(context, reminder, PendingIntent.FLAG_NO_CREATE);
        if (wake == null) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(wake);
        wake.cancel();
    }

    private static void channel(Context context, String id, int name, int importance) {
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        if (notifications == null || notifications.getNotificationChannel(id) != null) return;
        notifications.createNotificationChannel(new NotificationChannel(id, context.getString(name), importance));
    }

    private static Map<String, Reminder> load(Context context) {
        Map<String, Reminder> all = new LinkedHashMap<>();
        try {
            JSONArray stored = new JSONArray(prefs(context).getString(ALL, "[]"));
            for (Reminder each : parse(stored)) all.put(each.key, each);
        } catch (JSONException error) {
            // Unreadable: start over; the next hand-over sets them again.
        }
        return all;
    }

    private static void save(Context context, Map<String, Reminder> all) {
        JSONArray array = new JSONArray();
        try {
            for (Reminder each : all.values()) array.put(each.json());
        } catch (JSONException error) {
            throw new IllegalStateException(error);
        }
        prefs(context).edit().putString(ALL, array.toString()).apply();
    }

    /**
     * Builds before this one handed reminders to the Local Notifications plugin: clear what it still
     * has set, once, so nothing fires twice.
     */
    private static void migrateFromPlugin(Context context) {
        if (prefs(context).getBoolean(MIGRATED, false)) return;
        NotificationStorage storage = new NotificationStorage(context);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        for (LocalNotification saved : storage.getSavedNotifications()) {
            Integer id = saved.getId();
            if (id == null) continue;
            PendingIntent alarm = PendingIntent.getBroadcast(context, id, new Intent(context, TimedNotificationPublisher.class),
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_MUTABLE);
            if (alarm != null && alarms != null) {
                alarms.cancel(alarm);
                alarm.cancel();
            }
            storage.deleteNotification(String.valueOf(id));
        }
        prefs(context).edit().putBoolean(MIGRATED, true).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
