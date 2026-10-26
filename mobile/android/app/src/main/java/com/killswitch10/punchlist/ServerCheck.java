package com.killswitch10.punchlist;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.cert.CertPathValidatorException;
import java.security.cert.CertificateException;
import javax.net.ssl.SSLPeerUnverifiedException;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Asks an address whether it is a Punchlist server ({@code GET /api/info}) before the app moves to
 * it. Done natively: the bundled page runs on another origin, and the server sends no CORS headers.
 * Follows up to three redirects across schemes, so {@code http://} to {@code https://} lands on the
 * address the server really answers on.
 */
final class ServerCheck {

    /** Why an address is not usable, as the web app names it. */
    static final class Failure extends Exception {
        final String code;

        Failure(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    /** What the server said, and the origin it answered on. */
    static final class Result {
        final String origin;
        final JSONObject info;

        Result(String origin, JSONObject info) {
            this.origin = origin;
            this.info = info;
        }
    }

    private static final int TIMEOUT_MS = 8000;
    private static final int MAX_BODY = 64 * 1024;

    private ServerCheck() {}

    static Result check(String origin) throws Failure {
        String current = origin;
        for (int hop = 0; hop < 4; hop++) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(current + "/api/info").openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(TIMEOUT_MS);
                connection.setReadTimeout(TIMEOUT_MS);
                connection.setRequestProperty("Accept", "application/json");
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400 && connection.getHeaderField("Location") != null) {
                    String next = ServerChoice.normalize(new URL(new URL(current), connection.getHeaderField("Location")).toString());
                    if (next == null) throw new Failure("not-punchlist", "redirected away");
                    current = next;
                    continue;
                }
                if (status != 200) throw new Failure("not-punchlist", "status " + status);
                String type = connection.getContentType();
                if (type == null || !type.contains("json")) throw new Failure("not-punchlist", "not json");
                JSONObject info = new JSONObject(read(connection.getInputStream()));
                if (!"punchlist".equals(info.optString("name"))) throw new Failure("not-punchlist", "another app");
                return new Result(current, info);
            } catch (IOException error) {
                // A handshake that fails on the certificate is a trust problem; any other TLS
                // failure (a server speaking plain http, say) is just not reachable this way.
                throw new Failure(isCertificateProblem(error) ? "certificate" : "unreachable", error.getMessage());
            } catch (JSONException error) {
                throw new Failure("not-punchlist", "bad json");
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
        throw new Failure("not-punchlist", "too many redirects");
    }

    private static boolean isCertificateProblem(Throwable error) {
        for (Throwable each = error; each != null; each = each.getCause()) {
            if (each instanceof CertificateException || each instanceof CertPathValidatorException) return true;
            if (each instanceof SSLPeerUnverifiedException) return true;
        }
        return false;
    }

    private static String read(InputStream stream) throws IOException {
        try (InputStream in = stream) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int total = 0;
            for (int count; (count = in.read(buffer)) != -1; ) {
                total += count;
                if (total > MAX_BODY) throw new IOException("answer too large");
                out.write(buffer, 0, count);
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
