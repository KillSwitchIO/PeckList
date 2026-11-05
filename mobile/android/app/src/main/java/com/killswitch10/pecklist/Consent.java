package com.killswitch10.pecklist;

/**
 * Whether a page may move the app to a server (audit A2, A4). On a server, the pages are the
 * server's: one that was taken over, or an http one changed on the way, could point the app at a
 * lookalike for good, so the person says yes in the app's own dialog. Standalone, the page is the
 * app's own connect page, which has shown its warnings and says what the person agreed to.
 */
final class Consent {

    enum Answer {
        /** Go there. */
        GO,
        /** Ask in the app's own dialog first. */
        ASK,
        /** Plain http the person was not asked about: refuse. */
        REFUSE_PLAIN,
    }

    private Consent() {}

    static Answer toConnect(boolean onServer, boolean plain, boolean plainAgreed) {
        if (onServer) return Answer.ASK;
        if (plain && !plainAgreed) return Answer.REFUSE_PLAIN;
        return Answer.GO;
    }

    static Answer toDisconnect(boolean onServer) {
        return onServer ? Answer.ASK : Answer.GO;
    }
}
