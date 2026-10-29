package com.killswitch10.punchlist;

import android.content.Context;
import android.net.Uri;
import android.webkit.CookieManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Linking a provider account from Settings (ADR-0017), like NativeSignIn but the other way round:
 * the person is signed in to the app, not to the browser tab the provider runs in. So the app asks
 * the server, with its own session cookie, for a one-time link code
 * ({@code POST /auth/app/link-start}), opens {@code /auth/app/link?code=...} in a Custom Tab, and
 * the server sends the outcome back to {@code <package>://link?result=...}.
 */
final class NativeLink {

    private static final Pattern LINK = Pattern.compile("^/auth/oidc/([^/]+)/link/?$");
    private static final Pattern OUTCOME = Pattern.compile("^[a-z_]{1,20}$");
    private static final int TIMEOUT_MS = 10000;

    private NativeLink() {}

    /** The provider a navigation starts linking, if it is one on this server; else null. */
    static String providerOf(String server, Uri url) {
        if (server == null || !ServerChoice.sameOrigin(server, url.toString()) || url.getPath() == null) return null;
        Matcher match = LINK.matcher(url.getPath());
        return match.matches() ? match.group(1) : null;
    }

    /** Where the browser tab starts linking; throws when the server will not start one. Network: call off the main thread. */
    static Uri start(Context context, String server, String provider) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(server + "/auth/app/link-start").openConnection();
        ClientCert.apply(context, connection);
        try {
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/json");
            String cookies = CookieManager.getInstance().getCookie(server);
            if (cookies != null) connection.setRequestProperty("Cookie", cookies);
            byte[] body = new JSONObject()
                .put("provider", provider)
                .put("scheme", context.getPackageName())
                .toString()
                .getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            if (connection.getResponseCode() != 200) throw new IOException("link-start answered " + connection.getResponseCode());
            String path = new JSONObject(read(connection.getInputStream())).getString("url");
            if (!path.startsWith("/auth/app/link?")) throw new IOException("unexpected link address");
            return Uri.parse(server + path);
        } catch (JSONException error) {
            throw new IOException("bad answer from link-start", error);
        } finally {
            connection.disconnect();
        }
    }

    /** Whether a link that opened the app is a provider link coming back. */
    static boolean isReturn(Context context, Uri data) {
        return data != null && context.getPackageName().equals(data.getScheme()) && "link".equals(data.getHost());
    }

    /** The settings page that reports how linking went (SignInSection reads ?link=). */
    static String settingsUrl(String server, Uri data) {
        String result = data.getQueryParameter("result");
        if (result == null || !OUTCOME.matcher(result).matches()) result = "failed";
        return server + "/settings?link=" + result;
    }

    private static String read(InputStream stream) throws IOException {
        try (InputStream in = stream) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            for (int count; (count = in.read(buffer)) != -1; ) out.write(buffer, 0, count);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
