package com.pecklist.app;

import android.content.Context;
import android.net.http.X509TrustManagerExtensions;
import com.getcapacitor.Logger;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.List;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/**
 * Whether a server is trusted only through a certificate authority installed on this phone (audit
 * A2). The app trusts those (network_security_config.xml), for servers behind a home CA, but only
 * for servers the person agreed to (ServerChoice): anything else installed one could read what the
 * app sends. Android fixes the WebView's trust when the app is built, so the app checks natively:
 * when connecting, at each background check-in, and at each start.
 */
final class InstalledCa {

    private static final int TIMEOUT_MS = 8000;

    private InstalledCa() {}

    /**
     * Whether the answer on {@code connection} (after its response) came with a certificate that
     * only an installed authority vouches for. False when it cannot tell: the handshake passed.
     */
    static boolean reliedOn(HttpURLConnection connection) {
        if (!(connection instanceof HttpsURLConnection)) return false;
        try {
            Certificate[] presented = ((HttpsURLConnection) connection).getServerCertificates();
            X509Certificate[] chain = new X509Certificate[presented.length];
            for (int i = 0; i < presented.length; i++) chain[i] = (X509Certificate) presented[i];
            X509TrustManagerExtensions trust = new X509TrustManagerExtensions(platform());
            List<X509Certificate> path = trust.checkServerTrusted(chain, "GENERIC", connection.getURL().getHost());
            for (X509Certificate each : path) {
                if (trust.isUserAddedCertificate(each)) return true;
            }
            return false;
        } catch (Exception error) {
            Logger.warn("PeckList", "Could not tell who vouches for " + connection.getURL().getHost() + ": " + error);
            return false;
        }
    }

    /**
     * Whether the chosen server now relies on an installed authority the person did not agree to.
     * Network: call off the main thread. False when it cannot be reached (the WebView says so).
     */
    static boolean unagreed(Context context, String server) {
        if (!server.startsWith("https://") || ServerChoice.installedCaAgreed(context, server)) return false;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(server + "/api/info").openConnection();
            ClientCert.apply(context, connection);
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.getResponseCode();
            return reliedOn(connection);
        } catch (Exception error) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static X509TrustManager platform() throws Exception {
        TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init((KeyStore) null);
        for (TrustManager each : factory.getTrustManagers()) {
            if (each instanceof X509TrustManager) return (X509TrustManager) each;
        }
        throw new IllegalStateException("no X509 trust manager");
    }
}
