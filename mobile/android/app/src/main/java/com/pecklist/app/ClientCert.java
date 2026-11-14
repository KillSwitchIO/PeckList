package com.pecklist.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.KeyChain;
import android.security.KeyChainException;
import android.webkit.ClientCertRequest;
import com.getcapacitor.Logger;
import java.net.HttpURLConnection;
import java.net.Socket;
import java.security.Principal;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.X509KeyManager;

/**
 * Mutual TLS (R-FB-158): a server, or the proxy in front of it, that asks for a client
 * certificate gets the one the person picked from Android's own store (KeyChain: Settings,
 * Security, Encryption and credentials, Install a certificate). The pick is remembered, so the
 * WebView, the server check, the background check and the reminder buttons all present it without
 * asking again; leaving the server forgets it.
 */
final class ClientCert {
    private static final String PREFS = "pecklist.clientcert";
    private static final String ALIAS = "alias";
    private static final Executor KEYS = Executors.newSingleThreadExecutor();

    private ClientCert() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String alias(Context context) {
        return prefs(context).getString(ALIAS, null);
    }

    static void remember(Context context, String alias) {
        prefs(context).edit().putString(ALIAS, alias).apply();
    }

    /** Leaving the server: the certificate was for it. */
    static void forget(Context context) {
        prefs(context).edit().remove(ALIAS).apply();
    }

    /** The WebView was asked for a certificate: the remembered one, else the person picks. */
    static void answer(Activity activity, ClientCertRequest request) {
        Context context = activity.getApplicationContext();
        String saved = alias(context);
        if (saved != null) {
            KEYS.execute(() -> {
                if (!proceed(context, request, saved)) {
                    // Gone from the store (removed, or the phone reset): ask again.
                    forget(context);
                    activity.runOnUiThread(() -> choose(activity, request));
                }
            });
            return;
        }
        choose(activity, request);
    }

    private static void choose(Activity activity, ClientCertRequest request) {
        Context context = activity.getApplicationContext();
        KeyChain.choosePrivateKeyAlias(activity, chosen -> {
            if (chosen == null) {
                request.cancel();
                return;
            }
            remember(context, chosen);
            KEYS.execute(() -> {
                if (!proceed(context, request, chosen)) request.cancel();
            });
        }, request.getKeyTypes(), request.getPrincipals(), request.getHost(), request.getPort(), null);
    }

    private static boolean proceed(Context context, ClientCertRequest request, String alias) {
        try {
            PrivateKey key = KeyChain.getPrivateKey(context, alias);
            X509Certificate[] chain = KeyChain.getCertificateChain(context, alias);
            if (key == null || chain == null) return false;
            request.proceed(key, chain);
            return true;
        } catch (KeyChainException | InterruptedException error) {
            Logger.warn("PeckList", "Client certificate " + alias + " unavailable: " + error.getMessage());
            return false;
        }
    }

    /**
     * Ask the person for a certificate for host:port, off the main thread, waiting for the answer
     * (the server check). True when one was picked.
     */
    static boolean pick(Activity activity, String host, int port) {
        CountDownLatch done = new CountDownLatch(1);
        String[] picked = { null };
        activity.runOnUiThread(() -> KeyChain.choosePrivateKeyAlias(activity, chosen -> {
            picked[0] = chosen;
            done.countDown();
        }, null, null, host, port, alias(activity)));
        try {
            if (!done.await(5, TimeUnit.MINUTES)) return false;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return false;
        }
        if (picked[0] == null) return false;
        remember(activity.getApplicationContext(), picked[0]);
        return true;
    }

    /** The app's own requests present the certificate too (nothing changes without one). */
    static void apply(Context context, HttpURLConnection connection) {
        if (!(connection instanceof HttpsURLConnection)) return;
        SSLSocketFactory factory = socketFactory(context);
        if (factory != null) ((HttpsURLConnection) connection).setSSLSocketFactory(factory);
    }

    private static SSLSocketFactory socketFactory(Context context) {
        String alias = alias(context);
        if (alias == null) return null;
        try {
            PrivateKey key = KeyChain.getPrivateKey(context, alias);
            X509Certificate[] chain = KeyChain.getCertificateChain(context, alias);
            if (key == null || chain == null) return null;
            SSLContext tls = SSLContext.getInstance("TLS");
            tls.init(new KeyManager[] { new Fixed(alias, key, chain) }, null, null);
            return tls.getSocketFactory();
        } catch (Exception error) {
            Logger.warn("PeckList", "Client certificate " + alias + " unavailable: " + error.getMessage());
            return null;
        }
    }

    /** Always the one certificate. */
    private static final class Fixed implements X509KeyManager {
        private final String alias;
        private final PrivateKey key;
        private final X509Certificate[] chain;

        Fixed(String alias, PrivateKey key, X509Certificate[] chain) {
            this.alias = alias;
            this.key = key;
            this.chain = chain;
        }

        @Override
        public String chooseClientAlias(String[] keyType, Principal[] issuers, Socket socket) {
            return alias;
        }

        @Override
        public String[] getClientAliases(String keyType, Principal[] issuers) {
            return new String[] { alias };
        }

        @Override
        public X509Certificate[] getCertificateChain(String name) {
            return alias.equals(name) ? chain : null;
        }

        @Override
        public PrivateKey getPrivateKey(String name) {
            return alias.equals(name) ? key : null;
        }

        @Override
        public String chooseServerAlias(String keyType, Principal[] issuers, Socket socket) {
            return null;
        }

        @Override
        public String[] getServerAliases(String keyType, Principal[] issuers) {
            return null;
        }
    }
}
