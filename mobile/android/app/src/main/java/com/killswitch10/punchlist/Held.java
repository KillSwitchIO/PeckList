package com.killswitch10.punchlist;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Complete and Snooze pressed on a reminder that only the web app can finish: standalone (the
 * tasks live in the app), or a server too old to move a repeating task itself (409). The
 * notification goes at once and the app does not open; the web app takes these the next time it
 * runs or comes back to the screen (shell api 7, {@link ShellPlugin#held}). Each is kept for the
 * server it was pressed on (null standalone), so only that server's tasks are touched.
 */
final class Held {

    private static final String PREFS = "punchlist.held";
    private static final String ALL = "all";
    private static final long KEEP_MS = 7L * 24 * 60 * 60 * 1000;

    /** Told when one is held, so a web app on screen (or paused behind the shade) takes it at once. */
    interface Listener {
        void held();
    }

    private static volatile Listener listener;

    private Held() {}

    static void listen(Listener next) {
        listener = next;
    }

    static void add(Context context, String button, String taskId, int minutes) {
        synchronized (Held.class) {
            JSONArray all = load(context);
            try {
                String server = ServerChoice.get(context);
                all.put(new JSONObject()
                    .put("action", button)
                    .put("taskId", taskId)
                    .put("minutes", minutes)
                    .put("at", System.currentTimeMillis())
                    .put("server", server == null ? JSONObject.NULL : server));
            } catch (JSONException error) {
                throw new IllegalStateException(error);
            }
            prefs(context).edit().putString(ALL, all.toString()).commit();
        }
        Listener now = listener;
        if (now != null) now.held();
    }

    /**
     * The presses for the server the app is on now (or standalone), oldest first, and none of
     * them left. Others stay for their own server; a week old, they go.
     */
    static synchronized JSONArray take(Context context) {
        JSONArray all = load(context);
        JSONArray mine = new JSONArray();
        JSONArray rest = new JSONArray();
        String server = ServerChoice.get(context);
        long oldest = System.currentTimeMillis() - KEEP_MS;
        for (int i = 0; i < all.length(); i++) {
            JSONObject each = all.optJSONObject(i);
            if (each == null || each.optLong("at") < oldest) continue;
            String pressedOn = each.isNull("server") ? null : each.optString("server");
            boolean here = server == null ? pressedOn == null : server.equalsIgnoreCase(pressedOn);
            if (!here) {
                rest.put(each);
                continue;
            }
            JSONObject press = new JSONObject();
            try {
                press.put("action", each.optString("action"))
                    .put("taskId", each.optString("taskId"))
                    .put("minutes", each.optInt("minutes", Reminders.SNOOZE_MINUTES))
                    .put("at", each.optLong("at"));
            } catch (JSONException error) {
                throw new IllegalStateException(error);
            }
            mine.put(press);
        }
        prefs(context).edit().putString(ALL, rest.toString()).commit();
        return mine;
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
