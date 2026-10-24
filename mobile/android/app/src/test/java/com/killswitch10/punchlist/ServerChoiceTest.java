package com.killswitch10.punchlist;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ServerChoiceTest {

    @Test
    public void aBareHostMeansHttps() {
        assertEquals("https://punchlist.example.com", ServerChoice.normalize("punchlist.example.com"));
        assertEquals("https://punchlist.example.com", ServerChoice.normalize("  Punchlist.Example.com/  "));
    }

    @Test
    public void pathsQueriesAndDefaultPortsAreDropped() {
        assertEquals("https://example.com", ServerChoice.normalize("https://example.com:443/today?x=1#y"));
        assertEquals("http://192.168.1.20:8080", ServerChoice.normalize("http://192.168.1.20:8080/"));
        assertEquals("http://nas.lan", ServerChoice.normalize("HTTP://nas.lan:80"));
    }

    @Test
    public void onlyHttpAndHttpsAddresses() {
        assertNull(ServerChoice.normalize(""));
        assertNull(ServerChoice.normalize(null));
        assertNull(ServerChoice.normalize("ftp://example.com"));
        assertNull(ServerChoice.normalize("javascript:alert(1)"));
        assertNull(ServerChoice.normalize("https://user:pass@example.com"));
        assertNull(ServerChoice.normalize("https://"));
        assertNull(ServerChoice.normalize("not a host"));
    }

    @Test
    public void sameOriginComparesSchemeHostAndPort() {
        assertTrue(ServerChoice.sameOrigin("https://example.com", "https://example.com/auth/oidc/x/login"));
        assertFalse(ServerChoice.sameOrigin("https://example.com", "http://example.com/auth/oidc/x/login"));
        assertFalse(ServerChoice.sameOrigin("https://example.com", "https://example.com:8443/"));
        assertFalse(ServerChoice.sameOrigin("https://example.com", "https://evil.example/"));
        assertFalse(ServerChoice.sameOrigin(null, "https://example.com/"));
    }
}
