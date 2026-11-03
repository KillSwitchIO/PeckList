package com.killswitch10.pecklist;

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

    /**
     * Notification channels, one per kind so the phone's own settings can quiet any one of them
     * (spec: PL-115). Versioned: Android keeps a channel's settings as first created, and the first
     * ones had no vibration, so these replace them and the old two are deleted.
     */
    static final String CHANNEL = "reminders.v2";
    static final String ASSIGNMENTS = "assignments.v2";
    static final String SHARES = "shares.v2";
    static final String COMMENTS = "comments.v2";
    private static final String[] OLD_CHANNELS = { "reminders", "activity" };

    /** A constant reminder stops buzzing after this long (PL-115): a quiet copy replaces it. */
    static final long QUIET_AFTER_MS = 30 * 60 * 1000;
    /** The key suffix of that quiet copy; it shares the tag, so it replaces the loud one on screen. */
    static final String QUIET = "#quiet";
    /** How long Snooze puts a reminder off (the web app's SNOOZE_MINUTES). */
    static final int SNOOZE_MINUTES = 10;

    static final String FIRE = "com.killswitch10.pecklist.REMINDER";
    static final String COMPLETE = "complete";
    static final String SNOOZE = "snooze";

    /** Intent extras for the app: where to go, and a button to finish there (MainActivity, ShellPlugin). */
    static final String EXTRA_URL = "pecklist.url";
    static final String EXTRA_ACTION = "pecklist.action";
    static final String EXTRA_TASK = "pecklist.task";
    static final String EXTRA_MINUTES = "pecklist.minutes";
    static final String EXTRA_SHOWN = "pecklist.shown";
    static final String EXTRA_REMINDER = "pecklist.reminder";

    private static final String PREFS = "pecklist.reminders";
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
        for (Reminder old : load(context).values()) {
            // The quiet copies this phone made for its constant reminders are its own to keep.
            if (old.key.endsWith(QUIET)) next.put(old.key, old);
        }
        for (Reminder each : wanted) {
            // A constant reminder's repeats are for browsers; here the notification itself keeps
            // sounding until touched (FLAG_INSISTENT), and goes quiet after QUIET_AFTER_MS.
            if (each.constant && each.key.contains("#")) continue;
            next.put(each.key, each);
        }
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
     * Show a reminder with Complete and Snooze. Neither opens the app (ReminderReceiver): on a
     * server they act there, repeating tasks too; standalone, the app finishes them the next time
     * it runs (Held). Snooze asks how long first.
     */
    static void show(Context context, Reminder reminder) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return;
        channel(context, CHANNEL, R.string.channel_reminders, NotificationManager.IMPORTANCE_HIGH);
        boolean quiet = reminder.key.endsWith(QUIET);
        NotificationCompat.Builder built = base(context, CHANNEL, reminder.title, reminder.body)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setWhen(reminder.at)
            .setOnlyAlertOnce(quiet)
            .setContentIntent(open(context, reminder))
            .addAction(0, context.getString(R.string.action_complete), act(context, reminder, COMPLETE))
            .addAction(0, context.getString(R.string.action_snooze), snoozePicker(context, reminder));
        android.app.Notification made = built.build();
        if (reminder.constant && !quiet) {
            // Keeps sounding and buzzing until it is opened, dismissed or a button is pressed
            // (spec: PL-115), and a quiet copy takes its place after QUIET_AFTER_MS.
            made.flags |= android.app.Notification.FLAG_INSISTENT;
            add(context, new Reminder(reminder.tag() + QUIET, reminder.title, reminder.body,
                reminder.at + QUIET_AFTER_MS, reminder.url, true, reminder.repeats));
        }
        NotificationManagerCompat.from(context).notify(reminder.shown(), made);
    }

    /** What is new from other people ({id, kind, title, body, url} from the check-in), shown now. */
    static void showNew(Context context, JSONArray notifications) throws JSONException {
        for (int i = 0; i < notifications.length(); i++) {
            JSONObject each = notifications.getJSONObject(i);
            showNews(context, each.getString("id"), each.optString("kind", ""), each.getString("title"), each.getString("body"),
                each.getString("url"), each.optJSONArray("actions"));
        }
    }

    /** The channel a kind of news goes to: shares, comments and mentions, or assignments and dibs. */
    static String channelOf(String kind) {
        switch (kind) {
            case "shared": return SHARES;
            case "commented": case "commentEdited": case "mentioned": return COMMENTS;
            default: return ASSIGNMENTS;
        }
    }

    /**
     * One piece of news (an assignment, a share, a comment), from the check-in or from the web app
     * while it is on screen (shell api 4), keyed by the server's id so the two never show it twice.
     */
    static void showNews(Context context, String newsId, String kind, String title, String body, String url, JSONArray actions)
        throws JSONException {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return;
        String channel = channelOf(kind);
        channel(context, channel, channel.equals(SHARES) ? R.string.channel_shares
            : channel.equals(COMMENTS) ? R.string.channel_comments : R.string.channel_assignments, NotificationManager.IMPORTANCE_DEFAULT);
        int id = idOf("news:" + newsId);
        Intent intent = new Intent(context, MainActivity.class)
            .setAction("com.killswitch10.pecklist.OPEN." + id)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_URL, url)
            .putExtra(EXTRA_SHOWN, id);
        NotificationCompat.Builder built = base(context, channel, title, body)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setContentIntent(PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        // Its buttons, left to right (R-FB-106, R-FB-107): each opens the app where it says.
        for (int a = 0; actions != null && a < actions.length(); a++) {
            JSONObject action = actions.getJSONObject(a);
            int code = idOf("news:" + newsId + ":" + action.getString("action"));
            Intent press = new Intent(context, MainActivity.class)
                .setAction("com.killswitch10.pecklist.OPEN." + code)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_URL, action.getString("url"))
                .putExtra(EXTRA_SHOWN, id);
            built.addAction(0, action.getString("title"),
                PendingIntent.getActivity(context, code, press, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        NotificationManagerCompat.from(context).notify(id, built.build());
    }

    static void cancelShown(Context context, int id) {
        NotificationManagerCompat.from(context).cancel(id);
    }

    private static NotificationCompat.Builder base(Context context, String channel, String title, String text) {
        return new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_pecklist)
            .setColor(ContextCompat.getColor(context, R.color.notification_accent))
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true);
    }

    /** Opens the app on the reminder's task. */
    private static PendingIntent open(Context context, Reminder reminder) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction("com.killswitch10.pecklist.OPEN.")
            .setData(Uri.parse("pecklist-reminder://" + reminder.alarm()))
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_URL, reminder.url)
            .putExtra(EXTRA_SHOWN, reminder.shown());
        return PendingIntent.getActivity(context, reminder.alarm(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Snooze asks how long first, as TickTick does (SnoozeActivity, a dialog over whatever is on screen). */
    private static PendingIntent snoozePicker(Context context, Reminder reminder) {
        Intent intent = new Intent(context, SnoozeActivity.class)
            .setData(Uri.parse("pecklist-reminder://" + reminder.alarm()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        try {
            intent.putExtra(EXTRA_REMINDER, reminder.json().toString());
        } catch (JSONException error) {
            throw new IllegalStateException(error);
        }
        return PendingIntent.getActivity(context, reminder.alarm(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Acts without opening the app (ReminderReceiver). */
    private static PendingIntent act(Context context, Reminder reminder, String action) {
        Intent intent = new Intent(context, ReminderReceiver.class)
            .setAction("com.killswitch10.pecklist." + action)
            .setData(Uri.parse("pecklist-reminder://" + reminder.alarm()));
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
            .setData(Uri.parse("pecklist-reminder://" + reminder.alarm()))
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
        if (notifications == null) return;
        for (String old : OLD_CHANNELS) {
            if (notifications.getNotificationChannel(old) != null) notifications.deleteNotificationChannel(old);
        }
        if (notifications.getNotificationChannel(id) != null) return;
        NotificationChannel made = new NotificationChannel(id, context.getString(name), importance);
        // Vibration on from the start (PL-115); the person turns it off per channel on the phone.
        made.enableVibration(true);
        made.setVibrationPattern(new long[] { 0, 250, 150, 250 });
        made.enableLights(true);
        notifications.createNotificationChannel(made);
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
