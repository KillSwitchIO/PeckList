package com.pecklist.app;

import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The app's notification channels (PL-115), one per kind, so Settings > Apps > PeckList >
 * Notifications lists each with its own on or off, sound and vibration. All of them are made when
 * the app starts (and after a restart or an update), not when the first of a kind arrives, so the
 * phone's list is complete on a fresh install. Two groups: reminders, and what other people do.
 *
 * <p>An app cannot change a channel once the person has touched it, but it can read it: {@link
 * #changes} tells the web app which kinds were switched on or off on the phone since it last asked,
 * so it can carry them into the synced in-app switches (settings.notifications).
 */
final class Channels {

    static final String GROUP_REMINDERS = "group.reminders";
    static final String GROUP_PEOPLE = "group.people";

    /** The kind the constant reminders' channel answers as; it has no in-app switch of its own. */
    static final String CONSTANT_KIND = "constant";

    /** The channels that build before this one made, with no vibration (PL-115). */
    private static final String[] OLD = { "reminders", "activity" };

    private static final String PREFS = "pecklist.channels";
    private static final String SEEN = "seen";

    /** Made once per process; making them again is harmless but needless. */
    private static volatile boolean made;

    private Channels() {}

    /** One channel: its id, the in-app switch it matches (settings.notifications), and how it looks on the phone. */
    static final class Channel {
        final String id;
        final String kind;
        final int name;
        final int description;
        final String group;
        final int importance;

        Channel(String id, String kind, int name, int description, String group, int importance) {
            this.id = id;
            this.kind = kind;
            this.name = name;
            this.description = description;
            this.group = group;
            this.importance = importance;
        }

        /** Whether its on or off is carried into an in-app switch. Constant reminders sit under Reminders there. */
        boolean synced() {
            return !CONSTANT_KIND.equals(kind);
        }
    }

    /** Every channel, in the order the phone lists them within their groups. */
    static final List<Channel> ALL = Collections.unmodifiableList(Arrays.asList(
        new Channel(Reminders.CHANNEL, "reminders", R.string.channel_reminders, R.string.channel_reminders_about,
            GROUP_REMINDERS, NotificationManager.IMPORTANCE_HIGH),
        new Channel(Reminders.CONSTANT, CONSTANT_KIND, R.string.channel_constant, R.string.channel_constant_about,
            GROUP_REMINDERS, NotificationManager.IMPORTANCE_HIGH),
        new Channel(Reminders.ASSIGNMENTS, "assignments", R.string.channel_assignments, R.string.channel_assignments_about,
            GROUP_PEOPLE, NotificationManager.IMPORTANCE_DEFAULT),
        new Channel(Reminders.SHARES, "shares", R.string.channel_shares, R.string.channel_shares_about,
            GROUP_PEOPLE, NotificationManager.IMPORTANCE_DEFAULT),
        new Channel(Reminders.COMMENTS, "comments", R.string.channel_comments, R.string.channel_comments_about,
            GROUP_PEOPLE, NotificationManager.IMPORTANCE_DEFAULT)
    ));

    /** The channel for an id, or null. */
    static Channel byId(String id) {
        for (Channel each : ALL) if (each.id.equals(id)) return each;
        return null;
    }

    /** The channel id for an in-app kind (reminders, assignments, shares, comments, constant), or null. */
    static String idOf(String kind) {
        for (Channel each : ALL) if (each.kind.equals(kind)) return each.id;
        return null;
    }

    /**
     * Make every channel and group, and drop the old ones. A channel already there keeps the
     * person's settings: only its name, description and (when it had none) group are updated.
     */
    static void ensure(Context context) {
        if (made || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        if (notifications == null) return;
        for (String old : OLD) {
            if (notifications.getNotificationChannel(old) != null) notifications.deleteNotificationChannel(old);
        }
        List<NotificationChannelGroup> groups = new ArrayList<>();
        groups.add(new NotificationChannelGroup(GROUP_REMINDERS, context.getString(R.string.channel_group_reminders)));
        groups.add(new NotificationChannelGroup(GROUP_PEOPLE, context.getString(R.string.channel_group_people)));
        notifications.createNotificationChannelGroups(groups);
        for (Channel each : ALL) {
            boolean fresh = notifications.getNotificationChannel(each.id) == null;
            NotificationChannel channel = new NotificationChannel(each.id, context.getString(each.name), each.importance);
            channel.setDescription(context.getString(each.description));
            channel.setGroup(each.group);
            if (fresh) {
                // Vibration on from the start (PL-115); the person turns it off per channel on the phone.
                channel.enableVibration(true);
                channel.setVibrationPattern(new long[] { 0, 250, 150, 250 });
                if (Reminders.soundless(each.id)) channel.setSound(null, null);
                channel.enableLights(true);
                channel.setShowBadge(true);
            }
            notifications.createNotificationChannel(channel);
        }
        made = true;
    }

    /** Every channel and group named again, in the app's language now (Languages, PL-148). */
    static void renamed(Context context) {
        made = false;
        ensure(context);
    }

    /**
     * The Local Notifications plugin makes a "Default" channel each time it loads (with the
     * activity), which the phone then lists under Other though nothing is ever sent to it: the shell
     * shows its own notifications, and older web builds name their channel. Dropped after each start.
     */
    static final String PLUGIN_DEFAULT = "default";

    static void dropPluginDefault(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        if (notifications != null && notifications.getNotificationChannel(PLUGIN_DEFAULT) != null) {
            notifications.deleteNotificationChannel(PLUGIN_DEFAULT);
        }
    }

    /**
     * Each channel's on or off, by kind. Off is the channel turned off, or its group. Notifications
     * off for the whole app is not a channel's state (the permission says that), so it is left out.
     * Empty before Android 8, which has no channels.
     */
    static Map<String, Boolean> read(Context context) {
        Map<String, Boolean> on = new LinkedHashMap<>();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return on;
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        if (notifications == null) return on;
        for (Channel each : ALL) {
            NotificationChannel channel = notifications.getNotificationChannel(each.id);
            if (channel == null) continue;
            boolean off = channel.getImportance() == NotificationManager.IMPORTANCE_NONE;
            if (!off && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && channel.getGroup() != null) {
                NotificationChannelGroup group = notifications.getNotificationChannelGroup(channel.getGroup());
                off = group != null && group.isBlocked();
            }
            on.put(each.kind, !off);
        }
        return on;
    }

    /**
     * The synced kinds whose channel was switched since {@code seen}: only a change counts, so a
     * switch turned on in the web app is never turned off again by a channel the phone has had off
     * all along. A kind not seen before is a starting point, not a change.
     */
    static Map<String, Boolean> changes(Map<String, Boolean> seen, Map<String, Boolean> now) {
        Map<String, Boolean> changed = new LinkedHashMap<>();
        for (Map.Entry<String, Boolean> each : now.entrySet()) {
            Channel channel = null;
            for (Channel known : ALL) if (known.kind.equals(each.getKey())) channel = known;
            if (channel == null || !channel.synced()) continue;
            Boolean before = seen.get(each.getKey());
            if (before != null && !before.equals(each.getValue())) changed.put(each.getKey(), each.getValue());
        }
        return changed;
    }

    /**
     * What shell api 10's notificationChannels answers: {channels: {kind: on}, changed: {kind: on}}.
     * Asking takes the changes: the next ask counts from now.
     */
    static synchronized JSONObject answer(Context context) throws JSONException {
        ensure(context);
        Map<String, Boolean> now = read(context);
        Map<String, Boolean> changed = changes(seen(context), now);
        remember(context, now);
        return new JSONObject().put("channels", new JSONObject(now)).put("changed", new JSONObject(changed));
    }

    private static Map<String, Boolean> seen(Context context) {
        Map<String, Boolean> seen = new LinkedHashMap<>();
        try {
            JSONObject stored = new JSONObject(prefs(context).getString(SEEN, "{}"));
            for (java.util.Iterator<String> keys = stored.keys(); keys.hasNext();) {
                String key = keys.next();
                seen.put(key, stored.getBoolean(key));
            }
        } catch (JSONException unreadable) {
            // Start over: the next ask is a starting point.
        }
        return seen;
    }

    private static void remember(Context context, Map<String, Boolean> now) {
        prefs(context).edit().putString(SEEN, new JSONObject(now).toString()).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
