package com.killswitch10.pecklist;

import android.content.Context;
import android.content.SharedPreferences;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * Which notification presses have been handled, kept across processes. A press that started the
 * app stays the task's launching intent, so Android hands it back, extras and all, when the app
 * returns from Recents after its process died. Without this, a thumbs up pressed once would be
 * left again each time.
 */
final class Presses {

    private static final String PREFS = "pecklist.presses";
    private static final String HANDLED = "handled";
    // Generous: the press to recognise is the one that started the app, which later presses into
    // the running app may have followed for weeks. About 37 KB, read only on a press.
    static final int KEEP = 1000;

    private Presses() {}

    /** A new id for a notification's intent: shown again, it is a new press. */
    static String newId() {
        return UUID.randomUUID().toString();
    }

    /**
     * The id of a notification shown before ids were added: the same for that notification each
     * time Android hands it back, and different for another one.
     */
    static String idFrom(String action, String data, String url) {
        return UUID.nameUUIDFromBytes((action + "|" + data + "|" + url).getBytes(StandardCharsets.UTF_8)).toString();
    }

    /** Whether this is the first time `id` is seen, which also marks it as seen. */
    static synchronized boolean first(Context context, String id) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String next = remember(prefs.getString(HANDLED, ""), id);
        if (next == null) return false;
        prefs.edit().putString(HANDLED, next).commit();
        return true;
    }

    /** The newest ids with `id` added, or null if it is already among them. */
    static String remember(String stored, String id) {
        List<String> ids = new ArrayList<>();
        if (!stored.isEmpty()) ids.addAll(Arrays.asList(stored.split(",")));
        if (ids.contains(id)) return null;
        ids.add(id);
        return String.join(",", ids.subList(Math.max(0, ids.size() - KEEP), ids.size()));
    }
}
