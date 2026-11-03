package com.killswitch10.pecklist;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Signing in with an identity provider from the app (ADR-0017). Providers are not run inside the
 * WebView: passkeys do not work there and some providers refuse embedded browsers. Instead the
 * provider's button opens {@code /auth/app/handoff} in a Custom Tab. After signing in there and
 * confirming, the server sends the browser to {@code <package>://auth?code=...}; the app trades
 * the code, with the verifier only it holds, for a session in its own WebView
 * ({@code POST /auth/app/redeem}). The pending verifier is kept on disk, so a sign-in survives
 * Android stopping the app while the Custom Tab is open.
 */
final class NativeSignIn {

    private static final String PREFS = "pecklist.signin";
    private static final String VERIFIER = "verifier";
    private static final String SERVER = "server";
    private static final String STARTED = "started";
    /** A sign-in left longer than this is forgotten (the server's code lives two minutes). */
    private static final long PENDING_MS = 15 * 60 * 1000;

    private static final Pattern LOGIN = Pattern.compile("^/auth/oidc/([^/]+)/login/?$");

    /** A started sign-in: where to open the Custom Tab. */
    static final class Start {
        final Uri handoff;

        Start(Uri handoff) {
            this.handoff = handoff;
        }
    }

    /** A finished sign-in: what to post to the server, in the WebView. */
    static final class Redeem {
        final String url;
        final byte[] body;

        Redeem(String url, byte[] body) {
            this.url = url;
            this.body = body;
        }
    }

    private NativeSignIn() {}

    /** The provider a navigation starts signing in with, if it is one on this server; else null. */
    static String providerOf(String server, Uri url) {
        if (server == null || !ServerChoice.sameOrigin(server, url.toString()) || url.getPath() == null) return null;
        Matcher match = LOGIN.matcher(url.getPath());
        return match.matches() ? match.group(1) : null;
    }

    static Start start(Context context, String server, Uri login, String provider) {
        String verifier = randomToken();
        prefs(context)
            .edit()
            .putString(VERIFIER, verifier)
            .putString(SERVER, server)
            .putLong(STARTED, System.currentTimeMillis())
            .apply();
        Uri.Builder handoff = Uri.parse(server + "/auth/app/handoff")
            .buildUpon()
            .appendQueryParameter("provider", provider)
            .appendQueryParameter("challenge", challengeOf(verifier))
            .appendQueryParameter("scheme", context.getPackageName());
        String returnUrl = login.getQueryParameter("returnUrl");
        if (returnUrl != null) handoff.appendQueryParameter("returnUrl", returnUrl);
        String invite = login.getQueryParameter("invite");
        if (invite != null) handoff.appendQueryParameter("invite", invite);
        return new Start(handoff.build());
    }

    /** Whether a link that opened the app is a sign-in coming back. */
    static boolean isReturn(Context context, Uri data) {
        return data != null && context.getPackageName().equals(data.getScheme()) && "auth".equals(data.getHost());
    }

    /** The redeem request for a sign-in that came back, or null when none of ours is pending. */
    static Redeem finish(Context context, String server, Uri data) {
        SharedPreferences prefs = prefs(context);
        String verifier = prefs.getString(VERIFIER, null);
        String pendingServer = prefs.getString(SERVER, null);
        long started = prefs.getLong(STARTED, 0);
        prefs.edit().clear().apply();
        String code = data.getQueryParameter("code");
        if (
            verifier == null ||
            code == null ||
            server == null ||
            !server.equals(pendingServer) ||
            System.currentTimeMillis() - started > PENDING_MS
        ) {
            return null;
        }
        String body = "code=" + Uri.encode(code) + "&verifier=" + Uri.encode(verifier);
        return new Redeem(server + "/auth/app/redeem", body.getBytes(StandardCharsets.UTF_8));
    }

    /** PKCE's S256: base64url of the SHA-256 of the verifier, without padding. */
    static String challengeOf(String verifier) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.encodeToString(hash, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    private static String randomToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
