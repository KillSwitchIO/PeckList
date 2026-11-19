package com.pecklist.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The widgets' own copy of the tasks (PL-121): the web app's last hand-over (shell api 12), and the
 * tasks ticked off on a widget, kept out of sight while the undo bar shows and then until a
 * hand-over no longer has them. App-private; signing out, another server or standalone clears it.
 */
final class WidgetStore {

    /** How long Undo shows after a tick, before the complete is sent. */
    static final long UNDO_MS = 4000;
    /** A ticked task stays out of sight at most this long if no hand-over comes. */
    static final long DONE_KEPT_MS = 24 * 60 * 60 * 1000L;

    private static final String PREFS = "pecklist.widget";
    private static final String FEED = "feed";
    private static final String TICKED = "ticked";
    private static final String DONE = "done";

    private WidgetStore() {}

    /** A tick whose undo time is over: to be sent as Complete. */
    static final class Tick {
        final String id;
        final String title;
        final long at;

        Tick(String id, String title, long at) {
            this.id = id;
            this.title = title;
            this.at = at;
        }
    }

    /** The web app's hand-over: {asOf, tasks}. A done task the hand-over no longer has is let go. */
    static synchronized void save(Context context, JSONObject feed) throws JSONException {
        Set<String> handed = new HashSet<>();
        JSONArray tasks = feed.optJSONArray("tasks");
        for (int i = 0; tasks != null && i < tasks.length(); i++) handed.add(tasks.getJSONObject(i).optString("id"));
        JSONObject done = object(context, DONE);
        long now = System.currentTimeMillis();
        for (Iterator<String> ids = done.keys(); ids.hasNext();) {
            String id = ids.next();
            if (!handed.contains(id) || now - done.optLong(id) > DONE_KEPT_MS) ids.remove();
        }
        prefs(context).edit().putString(FEED, feed.toString()).putString(DONE, done.toString()).apply();
    }

    /** Whether there is a hand-over at all (none: never opened, or signed out). */
    static boolean has(Context context) {
        return prefs(context).contains(FEED);
    }

    static String asOf(Context context) {
        return object(context, FEED).optString("asOf", null);
    }

    static List<WidgetTasks.Task> tasks(Context context) {
        List<WidgetTasks.Task> all = new ArrayList<>();
        JSONArray tasks = object(context, FEED).optJSONArray("tasks");
        for (int i = 0; tasks != null && i < tasks.length(); i++) {
            JSONObject each = tasks.optJSONObject(i);
            if (each == null || !WidgetTasks.safeId(each.optString("id"))) continue;
            all.add(new WidgetTasks.Task(each.optString("id"), each.optString("title"), each.optString("on", null),
                each.optString("next", null), each.has("time") ? each.optString("time") : null,
                each.optInt("priority", 0), each.optString("color", "")));
        }
        return all;
    }

    /** Tasks out of sight: ticked (undo still showing) or done. */
    static synchronized Set<String> hidden(Context context) {
        Set<String> hidden = new HashSet<>();
        for (Iterator<String> ids = object(context, TICKED).keys(); ids.hasNext();) hidden.add(ids.next());
        for (Iterator<String> ids = object(context, DONE).keys(); ids.hasNext();) hidden.add(ids.next());
        return hidden;
    }

    /** Ticked off on a widget just now. */
    static synchronized void tick(Context context, String id, String title, long now) {
        JSONObject ticked = object(context, TICKED);
        try {
            ticked.put(id, new JSONObject().put("title", title).put("at", now));
        } catch (JSONException error) {
            throw new IllegalStateException(error);
        }
        prefs(context).edit().putString(TICKED, ticked.toString()).apply();
    }

    /** Undo pressed: back in sight, nothing sent. False when it was already sent. */
    static synchronized boolean untick(Context context, String id) {
        JSONObject ticked = object(context, TICKED);
        if (ticked.remove(id) == null) return false;
        prefs(context).edit().putString(TICKED, ticked.toString()).apply();
        return true;
    }

    /** The tick the undo bar offers to take back: the latest still in its undo time, or null. */
    static synchronized Tick undoable(Context context, long now) {
        JSONObject ticked = object(context, TICKED);
        Tick latest = null;
        for (Iterator<String> ids = ticked.keys(); ids.hasNext();) {
            String id = ids.next();
            JSONObject each = ticked.optJSONObject(id);
            long at = each == null ? 0 : each.optLong("at");
            if (now - at < UNDO_MS && (latest == null || at > latest.at)) latest = new Tick(id, each.optString("title"), at);
        }
        return latest;
    }

    /** The ticks whose undo time is over, moved to done: the caller sends them. */
    static synchronized List<Tick> takeDue(Context context, long now) {
        JSONObject ticked = object(context, TICKED);
        JSONObject done = object(context, DONE);
        List<Tick> due = new ArrayList<>();
        for (Iterator<String> ids = ticked.keys(); ids.hasNext();) {
            String id = ids.next();
            JSONObject each = ticked.optJSONObject(id);
            long at = each == null ? 0 : each.optLong("at");
            if (now - at < UNDO_MS) continue;
            due.add(new Tick(id, each == null ? "" : each.optString("title"), at));
            ids.remove();
            try {
                done.put(id, at);
            } catch (JSONException error) {
                throw new IllegalStateException(error);
            }
        }
        if (!due.isEmpty()) prefs(context).edit().putString(TICKED, ticked.toString()).putString(DONE, done.toString()).apply();
        return due;
    }

    /** A sent tick the server refused for good: back in sight. False when it was not one. */
    static synchronized boolean undone(Context context, String id) {
        JSONObject done = object(context, DONE);
        if (done.remove(id) == null) return false;
        prefs(context).edit().putString(DONE, done.toString()).apply();
        return true;
    }

    /** Signing out, another server or standalone: nothing of the old tasks stays. */
    static synchronized void clear(Context context) {
        prefs(context).edit().clear().apply();
    }

    private static JSONObject object(Context context, String key) {
        try {
            return new JSONObject(prefs(context).getString(key, "{}"));
        } catch (JSONException unreadable) {
            return new JSONObject();
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
