package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.webkit.WebResourceResponse;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/** The whole store's read (api 18, PL-149): which requests it answers, and how. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class WholeStoreReadTest {

    private static Map<String, String> headers(String name, String value) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Accept", "*/*");
        headers.put(name, value);
        return headers;
    }

    @Test
    public void answersOnlyAGetOfItsPathThatSaysItIsThePages() {
        assertTrue(WholeStoreRead.asks("GET", WholeStoreRead.PATH, headers("X-PeckList-Store", "1")));
        // WebView may hand headers over in any case.
        assertTrue(WholeStoreRead.asks("get", WholeStoreRead.PATH, headers("x-pecklist-store", "1")));
        assertFalse(WholeStoreRead.asks("GET", WholeStoreRead.PATH, headers("X-PeckList-Store", "0")));
        assertFalse(WholeStoreRead.asks("GET", WholeStoreRead.PATH, headers("X-Other", "1")));
        assertFalse(WholeStoreRead.asks("GET", WholeStoreRead.PATH, Collections.emptyMap()));
        assertFalse(WholeStoreRead.asks("GET", WholeStoreRead.PATH, null));
        assertFalse(WholeStoreRead.asks("POST", WholeStoreRead.PATH, headers("X-PeckList-Store", "1")));
        assertFalse(WholeStoreRead.asks("OPTIONS", WholeStoreRead.PATH, headers("X-PeckList-Store", "1")));
        assertFalse(WholeStoreRead.asks("GET", WholeStoreRead.PATH + "/", headers("X-PeckList-Store", "1")));
        assertFalse(WholeStoreRead.asks("GET", "/today", headers("X-PeckList-Store", "1")));
    }

    @Test
    public void refusesARequestThatSaysItComesFromAnotherOrigin() {
        String origin = "https://tasks.example.com";
        assertFalse("the page's own GET sends no Origin", WholeStoreRead.fromElsewhere(headers("Accept", "*/*"), origin));
        assertFalse(WholeStoreRead.fromElsewhere(null, origin));
        assertFalse(WholeStoreRead.fromElsewhere(headers("origin", "https://tasks.example.com"), origin));
        assertTrue(WholeStoreRead.fromElsewhere(headers("Origin", "https://evil.example"), origin));
        assertTrue("an opaque origin is another", WholeStoreRead.fromElsewhere(headers("Origin", "null"), origin));
        assertTrue(WholeStoreRead.fromElsewhere(headers("Origin", "https://tasks.example.com:8443"), origin));
    }

    @Test
    public void answersTheStoreAsJsonMarkedAsTheShellsAndNeverKept() throws Exception {
        WebResourceResponse answer = WholeStoreRead.answer("{\"header\":null,\"rows\":[]}".getBytes(StandardCharsets.UTF_8), false);
        assertEquals(200, answer.getStatusCode());
        assertEquals("application/json", answer.getMimeType());
        assertEquals("1", answer.getResponseHeaders().get(WholeStoreRead.HEADER));
        assertEquals("no-store", answer.getResponseHeaders().get("Cache-Control"));
        assertEquals("nosniff", answer.getResponseHeaders().get("X-Content-Type-Options"));
        assertNull("no other origin may read it", answer.getResponseHeaders().get("Access-Control-Allow-Origin"));
        assertEquals("{\"header\":null,\"rows\":[]}", new String(answer.getData().readAllBytes(), StandardCharsets.UTF_8));
    }

    @Test
    public void refusesWithoutSayingItIsTheShellsSoThePageReadsNothing() {
        WebResourceResponse refused = WholeStoreRead.answer(null, false);
        assertEquals(403, refused.getStatusCode());
        assertNull(refused.getResponseHeaders().get(WholeStoreRead.HEADER));
        WebResourceResponse failed = WholeStoreRead.answer(null, true);
        assertEquals(500, failed.getStatusCode());
        assertNull(failed.getResponseHeaders().get(WholeStoreRead.HEADER));
    }
}
