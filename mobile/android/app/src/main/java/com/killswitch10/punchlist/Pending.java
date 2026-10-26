package com.killswitch10.punchlist;

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

    private static final String PREFS = "punchlist.pending";
    private static final String ALL = "all";
    private static final long KEEP_MS = 7L * 24 * 60 * 60 * 1000;

    private Pending() {}

    static final class Press {
        final String button;
        final String taskId;
        final long first;
        final int minutes;

        Press(String button, String taskId, long first, int minutes) {
            this.button = button;
            this.taskId = taskId;
            this.first = first;
            this.minutes = minutes;
        }
    }

    static synchronized void add(Context context, String button, String taskId, long first, int minutes) {
        JSONArray all = load(context);
        try {
            all.put(new JSONObject()
                .put("button", button)
                .put("taskId", taskId)
                .put("first", first)
                .put("minutes", minutes)
                .put("at", System.currentTimeMillis()));
        } catch (JSONException error) {
            throw new IllegalStateException(error);
        }
        prefs(context).edit().putString(ALL, all.toString()).apply();
    }

    /** All of them, oldest first, and none left: whatever still fails is added back. */
    static synchronized List<Press> take(Context context) {
        JSONArray all = load(context);
        prefs(context).edit().remove(ALL).apply();
        List<Press> presses = new ArrayList<>();
        long oldest = System.currentTimeMillis() - KEEP_MS;
        for (int i = 0; i < all.length(); i++) {
            JSONObject each = all.optJSONObject(i);
            if (each == null || each.optLong("at") < oldest) continue;
            presses.add(new Press(each.optString("button"), each.optString("taskId"), each.optLong("first"), each.optInt("minutes", Reminders.SNOOZE_MINUTES)));
        }
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
