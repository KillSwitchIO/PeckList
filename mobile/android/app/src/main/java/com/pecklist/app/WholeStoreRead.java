package com.pecklist.app;

import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Api 18 (PL-149): the page reads its whole native store in one GET on its own origin, which
 * {@link ShellWebViewClient} answers from {@link NativeStore#whole} without going to the network.
 * The rows come as one JSON text the page parses once; a page of them through the bridge was JSON
 * inside JSON, escaped by org.json, and kept a cold start on the spinner for seconds.
 *
 * <p>Only the page's own origin reads it, and only when that is the app's or the connected
 * server's ({@link NativeStore#namespace}, against the WebView's address as the read is handled).
 * The request must carry {@link #HEADER}, which a page on another origin can only send after a CORS
 * preflight. That preflight is not answered here (on a server origin it goes on to the server,
 * which may answer it), so what keeps other origins out is that the answer has no CORS headers, and
 * that a request saying it comes from another origin ({@link #fromElsewhere}) is refused.
 */
final class WholeStoreRead {

    static final String PATH = "/__pecklist/native-store";
    static final String HEADER = "X-PeckList-Store";

    private WholeStoreRead() {
    }

    /** Whether a request is the page asking for its whole store. */
    static boolean asks(String method, String path, Map<String, String> headers) {
        if (!"GET".equalsIgnoreCase(method) || !PATH.equals(path) || headers == null) return false;
        for (Map.Entry<String, String> header : headers.entrySet()) {
            if (HEADER.equalsIgnoreCase(header.getKey())) return "1".equals(header.getValue());
        }
        return false;
    }

    /**
     * Whether a request says it comes from a page on another origin than {@code origin}: a
     * cross-origin fetch carries an Origin header, the page's own GET none.
     */
    static boolean fromElsewhere(Map<String, String> headers, String origin) {
        if (headers == null) return false;
        for (Map.Entry<String, String> header : headers.entrySet()) {
            if ("Origin".equalsIgnoreCase(header.getKey())) return !origin.equalsIgnoreCase(header.getValue());
        }
        return false;
    }

    /** The answer: the store's JSON, 403 for a page that may not read it, 500 when the read failed. */
    static WebResourceResponse answer(byte[] body, boolean failed) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        if (failed) return new WebResourceResponse("text/plain", "utf-8", 500, "Failed", headers, empty());
        if (body == null) return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", headers, empty());
        // Says the answer is the shell's: a page served at this path by anything else reads pages.
        headers.put(HEADER, "1");
        return new WebResourceResponse("application/json", "utf-8", 200, "OK", headers, new ByteArrayInputStream(body));
    }

    private static ByteArrayInputStream empty() {
        return new ByteArrayInputStream(new byte[0]);
    }
}
