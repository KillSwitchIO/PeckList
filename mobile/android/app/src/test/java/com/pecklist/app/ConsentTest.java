package com.pecklist.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Who may move the app to a server, and when the person is asked (audit A2, A4). */
public class ConsentTest {

    @Test
    public void aServersPageAlwaysGetsTheAppsOwnDialog() {
        assertEquals(Consent.Answer.ASK, Consent.toConnect(true, false, false));
        // Even when the page says the person agreed to plain http: it is the server's page.
        assertEquals(Consent.Answer.ASK, Consent.toConnect(true, true, true));
        assertEquals(Consent.Answer.ASK, Consent.toDisconnect(true));
        // Change server from the launcher shortcut, or any other app (Security 2026-11-19).
        assertEquals(Consent.Answer.ASK, Consent.toChangeServer(true, false));
    }

    @Test
    public void theAppsOwnConnectPageGoesOnceItsWarningsWereAnswered() {
        assertEquals(Consent.Answer.GO, Consent.toConnect(false, false, false));
        // The app's own Change server goes; with no server there is nothing to leave.
        assertEquals(Consent.Answer.GO, Consent.toChangeServer(true, true));
        assertEquals(Consent.Answer.GO, Consent.toChangeServer(false, false));
        assertEquals(Consent.Answer.GO, Consent.toConnect(false, true, true));
        assertEquals(Consent.Answer.GO, Consent.toDisconnect(false));
    }

    @Test
    public void plainHttpNobodyWasAskedAboutIsRefused() {
        assertEquals(Consent.Answer.REFUSE_PLAIN, Consent.toConnect(false, true, false));
    }
}
