package com.pecklist.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * Proof that a page to open (Reminders.EXTRA_URL) and what to do there came from this app's own
 * notifications. MainActivity is exported (the launcher, the sign-in returns), so any installed
 * app can start it with those extras; only intents this app built carry this install's token, and
 * ShellPlugin.opened ignores the rest (Security review 2026-11-19). The token is made once, kept in
 * app-private storage, and never logged or handed to the web app.
 */
final class NotificationToken {

    static final String EXTRA = "pecklist.token";
    private static final String PREFS = "pecklist.token";
    private static final String KEY = "notification";

    private NotificationToken() {}

    /** This install's token: 128 random bits, made on first use. */
    static synchronized String get(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String token = prefs.getString(KEY, null);
        if (token == null) {
            byte[] bytes = new byte[16];
            new SecureRandom().nextBytes(bytes);
            StringBuilder hex = new StringBuilder();
            for (byte each : bytes) hex.append(String.format("%02x", each));
            token = hex.toString();
            prefs.edit().putString(KEY, token).apply();
        }
        return token;
    }

    /** The intent, carrying the token, for a notification or another of this app's own ways in. */
    static Intent stamp(Context context, Intent intent) {
        return intent.putExtra(EXTRA, get(context));
    }

    /** Whether the intent carries this install's token. */
    static boolean carried(Context context, Intent intent) {
        return matches(get(context), intent == null ? null : intent.getStringExtra(EXTRA));
    }

    /** Whether `given` is `expected`, compared in constant time. */
    static boolean matches(String expected, String given) {
        if (expected == null || given == null) return false;
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), given.getBytes(StandardCharsets.UTF_8));
    }
}
