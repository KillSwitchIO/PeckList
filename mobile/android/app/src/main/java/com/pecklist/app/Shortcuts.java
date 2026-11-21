package com.pecklist.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The launcher icon's long-press menu: Add task, Today, Search and Change server
 * (res/xml/shortcuts.xml), and the list opened last, which the web app hands over (shell api 11).
 * A shortcut is an intent with {@link #ACTION} and a {@code pecklist-shortcut:/page} address; it
 * reaches the web app as a notification tap does (ShellPlugin's notificationOpen).
 */
final class Shortcuts {

    static final String ACTION = "com.pecklist.app.SHORTCUT";
    static final String SCHEME = "pecklist-shortcut";

    /**
     * How many lists get a shortcut. Launchers show four shortcuts and the static ones fill those,
     * so the last list comes after them: shown where a launcher has room, and always ready to pin.
     */
    static final int MAX_LISTS = 1;

    /** A list's shortcut id: "list:" and its id. */
    static final String LIST_PREFIX = "list:";

    /**
     * The pages a shortcut may open. MainActivity is exported, so any app can send this intent:
     * only these, never an address of its choosing.
     */
    private static final Pattern PAGES = Pattern.compile(
        "^/(today(\\?(add=1|task=[A-Za-z0-9_-]{1,64}))?|search|(upcoming|inbox)(\\?add=1)?"
            + "|(lists|filters)/[A-Za-z0-9_-]{1,64}(\\?add=1)?)$");

    private Shortcuts() {}

    /** The page a shortcut intent opens, or null when it is not one (or names a page not allowed). */
    static String pageOf(String action, String data) {
        if (!ACTION.equals(action) || data == null || !data.startsWith(SCHEME + ":")) return null;
        String page = data.substring(SCHEME.length() + 1);
        return PAGES.matcher(page).matches() ? page : null;
    }

    /**
     * A shortcut that started or came back to the app: handed on as a page to open (Reminders'
     * EXTRA_URL), once. Not one coming back from Recents, which would open it again, and not before
     * the app has somewhere to open it (the connect page stays).
     */
    static void open(Context context, Intent intent) {
        if (intent == null || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        String page = pageOf(intent.getAction(), intent.getDataString());
        if (page == null) return;
        if (ServerChoice.get(context) == null && !ServerChoice.choseStandalone(context)) return;
        // Vouched for with the app's token (NotificationToken) as one of its own ways in; any app
        // can send this intent, so nothing it carried beyond the page is kept.
        for (String extra : new String[] { Reminders.EXTRA_ACTION, Reminders.EXTRA_TASK, Reminders.EXTRA_MINUTES,
            Reminders.EXTRA_SHOWN }) {
            intent.removeExtra(extra);
        }
        NotificationToken.stamp(context, intent.putExtra(Reminders.EXTRA_URL, page).putExtra(Reminders.EXTRA_PRESS, Presses.newId()));
        String used = usedId(page);
        if (used != null) ShortcutManagerCompat.reportShortcutUsed(context, used);
    }

    /** The shortcut id a page belongs to, so the launcher can rank by use. */
    static String usedId(String page) {
        if (page.startsWith("/today?add")) return "add-task";
        if (page.equals("/today")) return "today";
        if (page.equals("/search")) return "search";
        // A list's own shortcut, not a widget's add bar on that list.
        if (page.startsWith("/lists/") && !page.contains("?")) return LIST_PREFIX + page.substring("/lists/".length());
        return null;
    }

    /** The lists to give shortcuts, of the {id, name} pairs offered: the first MAX_LISTS with an allowed id and a name. */
    static List<String[]> keep(List<String[]> offered) {
        List<String[]> kept = new ArrayList<>();
        for (String[] each : offered) {
            if (kept.size() >= MAX_LISTS) break;
            String name = each[1] == null ? "" : each[1].trim();
            if (name.isEmpty() || pageOf(ACTION, SCHEME + ":/lists/" + each[0]) == null) continue;
            kept.add(new String[] { each[0], name });
        }
        return kept;
    }

    private static List<String[]> listsOf(JSONArray lists) throws JSONException {
        List<String[]> offered = new ArrayList<>();
        for (int i = 0; lists != null && i < lists.length(); i++) {
            JSONObject each = lists.getJSONObject(i);
            offered.add(new String[] { each.optString("id", ""), each.optString("name", "") });
        }
        return keep(offered);
    }

    /** Api 11: the list shortcuts are these from now on (none clears them, as after signing out). */
    static void setLists(Context context, JSONArray lists) throws JSONException {
        List<ShortcutInfoCompat> made = new ArrayList<>();
        int rank = 0;
        for (String[] list : listsOf(lists)) {
            made.add(new ShortcutInfoCompat.Builder(context, LIST_PREFIX + list[0])
                .setShortLabel(list[1])
                .setLongLabel(list[1])
                .setIcon(IconCompat.createWithResource(context, R.drawable.ic_shortcut_list))
                .setIntent(intentFor(context, "/lists/" + list[0]))
                .setRank(rank++)
                .build());
        }
        ShortcutManagerCompat.setDynamicShortcuts(context, made);
    }

    /** No list shortcuts: on another server, or standalone, the old ones' lists are not there. */
    static void clear(Context context) {
        ShortcutManagerCompat.removeAllDynamicShortcuts(context);
    }

    private static Intent intentFor(Context context, String page) {
        return new Intent(ACTION, Uri.parse(SCHEME + ":" + page), context, MainActivity.class);
    }
}
