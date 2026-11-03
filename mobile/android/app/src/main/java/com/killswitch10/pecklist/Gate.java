package com.killswitch10.pecklist;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;
import android.webkit.CookieManager;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * A sign-in page in front of the server (Pangolin, Cloudflare Access, Authelia and the like; see
 * server/src/Punchlist.Server/Auth/AppGate.cs). The WebView is sent there and cannot pass it: the
 * gate's own sign-in often needs a passkey, which does not work in a WebView. So the person passes
 * it in a browser tab, our server hands the gate's cookies back sealed to a key made here, and
 * they go into the WebView's cookies. The key's private half never leaves the app.
 */
final class Gate {

    private static final String PREFS = "pecklist.gate";
    private static final String KEY = "key";
    private static final String SERVER = "server";
    private static final String STARTED = "started";
    /** A pass left longer than this is forgotten. */
    private static final long PENDING_MS = 15 * 60 * 1000;
    private static final int TIMEOUT_MS = 8000;
    /** How long the gate's cookies are kept here. */
    private static final int KEEP_SECONDS = 30 * 24 * 60 * 60;

    private Gate() {}

    /**
     * Whether the server sends the app elsewhere first, with the cookies the WebView has: a
     * redirect to another host. Network: call off the main thread. Unreachable is not gated.
     */
    static boolean gated(Context context, String server) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(server + "/api/info").openConnection();
            ClientCert.apply(context, connection);
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            String cookie = CookieManager.getInstance().getCookie(server);
            if (cookie != null) connection.setRequestProperty("Cookie", cookie);
            int status = connection.getResponseCode();
            String location = connection.getHeaderField("Location");
            return status >= 300 && status < 400 && location != null && elsewhere(server, new URL(new URL(server), location).toString());
        } catch (Exception error) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** Another host than the server's (a move to https on the same host is not a gate). */
    static boolean elsewhere(String server, String url) {
        String host = Uri.parse(url).getHost();
        return host != null && !host.equalsIgnoreCase(Uri.parse(server).getHost());
    }

    /** Where the browser tab goes: our server's gate page, with a fresh public key. */
    static Uri start(Context context, String server) throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        prefs(context)
            .edit()
            .putString(KEY, Base64.encodeToString(pair.getPrivate().getEncoded(), Base64.NO_WRAP))
            .putString(SERVER, server)
            .putLong(STARTED, System.currentTimeMillis())
            .commit();
        String key = Base64.encodeToString(pair.getPublic().getEncoded(), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        return Uri.parse(server + "/auth/app/gate")
            .buildUpon()
            .appendQueryParameter("key", key)
            .appendQueryParameter("scheme", context.getPackageName())
            .build();
    }

    static boolean isReturn(Context context, Uri data) {
        return data != null && context.getPackageName().equals(data.getScheme()) && "gate".equals(data.getHost());
    }

    /** The gate's cookies, into the WebView for the server they were passed for; how many. */
    static int finish(Context context, Uri data) throws Exception {
        SharedPreferences prefs = prefs(context);
        String stored = prefs.getString(KEY, null);
        String server = prefs.getString(SERVER, null);
        long started = prefs.getLong(STARTED, 0);
        prefs.edit().clear().apply();
        String sealed = data.getQueryParameter("data");
        if (stored == null || server == null || sealed == null || System.currentTimeMillis() - started > PENDING_MS) {
            throw new IllegalStateException("no pass waiting");
        }
        PrivateKey key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Base64.decode(stored, Base64.NO_WRAP)));
        JSONArray cookies = new JSONArray(new String(open(key, Base64.decode(sealed, Base64.URL_SAFE | Base64.NO_WRAP)), "UTF-8"));
        CookieManager manager = CookieManager.getInstance();
        boolean secure = server.startsWith("https://");
        for (int i = 0; i < cookies.length(); i++) {
            JSONObject each = cookies.getJSONObject(i);
            String name = each.optString("name", each.optString("Name"));
            String value = each.optString("value", each.optString("Value"));
            if (name.isEmpty()) continue;
            // Kept across restarts (a session cookie would not be): the gate's own expiry is not
            // passed on, so a month, and when the gate ends it sooner, it asks again.
            manager.setCookie(server, name + "=" + value + "; Path=/; Max-Age=" + KEEP_SECONDS + (secure ? "; Secure" : ""));
        }
        manager.flush();
        return cookies.length();
    }

    /** AppGate.Seal undone: RSA-OAEP-SHA256 key | 12-byte nonce | AES-GCM ciphertext and tag. */
    static byte[] open(PrivateKey key, byte[] sealed) throws Exception {
        int wrapped = 256;
        Cipher rsa = Cipher.getInstance("RSA/ECB/OAEPPadding");
        rsa.init(Cipher.DECRYPT_MODE, key,
            new OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT));
        byte[] aesKey = rsa.doFinal(Arrays.copyOfRange(sealed, 0, wrapped));
        Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
        aes.init(Cipher.DECRYPT_MODE, new SecretKeySpec(aesKey, "AES"), new GCMParameterSpec(128, sealed, wrapped, 12));
        return aes.doFinal(sealed, wrapped + 12, sealed.length - wrapped - 12);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
