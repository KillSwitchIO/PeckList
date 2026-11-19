package com.pecklist.app;

/**
 * Text for a new task from outside the app (PL-113): shared to PeckList, picked with "Add to
 * PeckList" on selected text, sent with the add-from-text intent, or spoken (AddTextActivity). The
 * shell keeps it here, in memory only, until the web app's add field takes it (shell api 13
 * takeAddText). It is never added on its own: the person reads it in the field and adds it.
 */
final class AddText {

    /** Longer than any title should be, and a bound on what another app can hand over. */
    static final int MAX_LENGTH = 500;
    /** Waiting longer means the app never opened the field (signed out, say): forgotten. */
    static final long KEPT_MS = 2 * 60 * 1000L;

    private static String text;
    private static long at;

    private AddText() {}

    /**
     * Text as a task title: one line, no control characters, trimmed and cut to MAX_LENGTH (never
     * inside a surrogate pair); null when nothing is left.
     */
    static String clean(CharSequence raw) {
        if (raw == null) return null;
        // Another app can hand over about a megabyte: only the start can matter.
        String text;
        if (raw.length() > 4 * MAX_LENGTH) {
            int end = 4 * MAX_LENGTH;
            if (Character.isHighSurrogate(raw.charAt(end - 1))) end--; // never half an emoji
            text = raw.subSequence(0, end).toString();
        } else {
            text = raw.toString();
        }
        String line = text.replaceAll("\\s+", " ").replaceAll("[\\p{Cc}\\p{Cf}&&[^\\u200d]]", "")
            .replaceAll(" {2,}", " ").trim();
        if (line.length() > MAX_LENGTH) {
            int end = MAX_LENGTH;
            if (Character.isHighSurrogate(line.charAt(end - 1))) end--;
            line = line.substring(0, end).trim();
        }
        return line.isEmpty() ? null : line;
    }

    static synchronized void put(String value, long now) {
        text = value;
        at = now;
    }

    /** The text waiting for the add field, once; null when there is none or it waited too long. */
    static synchronized String take(long now) {
        String waiting = text != null && now - at <= KEPT_MS ? text : null;
        text = null;
        return waiting;
    }
}
