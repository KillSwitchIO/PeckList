package com.killswitch10.punchlist;

import android.content.Context;
import android.content.SharedPreferences;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * The server this device uses, if any (ADR-0017). Null means standalone: the bundled web build with
 * its data on this device only. Kept in the app's own preferences, never in the web app's storage,
 * so it survives the WebView moving between origins.
 */
final class ServerChoice {

    private static final String PREFS = "punchlist.shell";
    private static final String SERVER = "server";
    private static final String STANDALONE = "standalone";

    private ServerChoice() {}

    static String get(Context context) {
        return prefs(context).getString(SERVER, null);
    }

    static void set(Context context, String origin) {
        prefs(context).edit().putString(SERVER, origin).remove(STANDALONE).apply();
    }

    static void clear(Context context) {
        prefs(context).edit().remove(SERVER).apply();
    }

    /** Off the server by choice (Disconnect, "Use on this device only"): no connect page on start. */
    static void chooseStandalone(Context context) {
        prefs(context).edit().remove(SERVER).putBoolean(STANDALONE, true).apply();
    }

    static boolean choseStandalone(Context context) {
        return prefs(context).getBoolean(STANDALONE, false);
    }

    /**
     * The origin a typed address means: {@code punchlist.example.com} is
     * {@code https://punchlist.example.com}, a path, query or trailing slash is dropped (the server
     * answers at its root). Null when it is not an http or https address.
     */
    static String normalize(String input) {
        if (input == null) return null;
        String text = input.trim();
        if (text.isEmpty()) return null;
        if (!text.contains("://")) text = "https://" + text;
        try {
            URI uri = new URI(text);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("https") && !scheme.equals("http")) return null;
            String host = uri.getHost();
            if (host == null || host.isEmpty() || uri.getRawUserInfo() != null) return null;
            int port = uri.getPort();
            boolean defaultPort = port == -1 || (scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80);
            return scheme + "://" + host.toLowerCase(Locale.ROOT) + (defaultPort ? "" : ":" + port);
        } catch (URISyntaxException error) {
            return null;
        }
    }

    /** Whether {@code url} (any address) is on the origin {@code origin}. */
    static boolean sameOrigin(String origin, String url) {
        String other = normalize(url);
        return origin != null && other != null && url.contains("://") && origin.equals(other);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
