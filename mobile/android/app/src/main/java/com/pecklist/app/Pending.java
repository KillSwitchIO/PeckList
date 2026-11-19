package com.pecklist.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Complete and Snooze pressed while the server could not be reached (ReminderReceiver): already
 * done on the phone, kept here until the server hears of them at the next check-in or start.
 * A week old, they go: the person has long since dealt with the task some other way.
 */
final class Pending {

    private static final String PREFS = "pecklist.pending";
    private static final String ALL = "all";
    private static final long KEEP_MS = 7L * 24 * 60 * 60 * 1000;
    /**
     * A snooze is kept before it is sent (ReminderReceiver.press), whose call waits up to its connect
     * and read timeouts (10 s each). Pressed more recently than this, it may still be on its way.
     */
    static final long IN_FLIGHT_MS = 25_000;

    private Pending() {}

    static final class Press {
        final String button;
        final String taskId;
        final long first;
        final int minutes;
        /** When it was pressed: a snooze counts from then (SnoozeTimes.left). */
        final long at;

        Press(String button, String taskId, long first, int minutes, long at) {
            this.button = button;
            this.taskId = taskId;
            this.first = first;
            this.minutes = minutes;
            this.at = at;
        }
    }

    static void add(Context context, String button, String taskId, long first, int minutes) {
        add(context, button, taskId, first, minutes, System.currentTimeMillis());
    }

    /** Added back after a failed try, still as of when it was pressed. */
    static synchronized void add(Context context, String button, String taskId, long first, int minutes, long at) {
        JSONArray all = load(context);
        try {
            all.put(new JSONObject()
                .put("button", button)
                .put("taskId", taskId)
                .put("first", first)
                .put("minutes", minutes)
                .put("at", at));
        } catch (JSONException error) {
            throw new IllegalStateException(error);
        }
        prefs(context).edit().putString(ALL, all.toString()).apply();
    }

    /** Take back one press kept before it was tried (a snooze), once the server has answered it. */
    static synchronized void remove(Context context, String button, String taskId, long at) {
        JSONArray all = load(context);
        JSONArray kept = new JSONArray();
        boolean removed = false;
        for (int i = 0; i < all.length(); i++) {
            JSONObject each = all.optJSONObject(i);
            if (each == null) continue;
            boolean same = button.equals(each.optString("button")) && taskId.equals(each.optString("taskId")) && each.optLong("at") == at;
            if (same && !removed) removed = true;
            else kept.put(each);
        }
        prefs(context).edit().putString(ALL, kept.toString()).apply();
    }

    /**
     * A snooze its own press may still be sending (the app opened as the picker closed): left for
     * the next try, so it is not sent twice at once, perhaps landing in two different minutes.
     */
    static boolean inFlight(String button, long at, long now) {
        return Reminders.SNOOZE.equals(button) && now - at < IN_FLIGHT_MS;
    }

    /** All of them, oldest first, and none left but those still on their way: whatever still fails is added back. */
    static synchronized List<Press> take(Context context) {
        JSONArray all = load(context);
        JSONArray left = new JSONArray();
        List<Press> presses = new ArrayList<>();
        long now = System.currentTimeMillis();
        long oldest = now - KEEP_MS;
        for (int i = 0; i < all.length(); i++) {
            JSONObject each = all.optJSONObject(i);
            if (each == null || each.optLong("at") < oldest) continue;
            if (inFlight(each.optString("button"), each.optLong("at"), now)) {
                left.put(each);
                continue;
            }
            presses.add(new Press(each.optString("button"), each.optString("taskId"), each.optLong("first"),
                each.optInt("minutes", Reminders.SNOOZE_MINUTES), each.optLong("at")));
        }
        if (left.length() == 0) prefs(context).edit().remove(ALL).apply();
        else prefs(context).edit().putString(ALL, left.toString()).apply();
        return presses;
    }

    private static JSONArray load(Context context) {
        try {
            return new JSONArray(prefs(context).getString(ALL, "[]"));
        } catch (JSONException error) {
            return new JSONArray();
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
