package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class AddTextTest {

    /** Shared or spoken text becomes one tidy line for the add field. */
    @Test
    public void textBecomesOneLine() {
        assertEquals("Buy milk tomorrow", AddText.clean("  Buy milk\n\ttomorrow  "));
        assertEquals("Call mom", AddText.clean("Call\u0007 mom‮"));
        assertEquals("Pay rent https://example.com/x", AddText.clean("Pay rent\r\nhttps://example.com/x"));
        assertEquals("a b", AddText.clean("a \u200b b"));
        assertNull(AddText.clean("  \n "));
        assertNull(AddText.clean(null));
    }

    /** Another app cannot hand over a novel, nor split an emoji at the cut. */
    @Test
    public void longTextIsCut() {
        StringBuilder long_ = new StringBuilder();
        for (int i = 0; i < AddText.MAX_LENGTH - 1; i++) long_.append('a');
        long_.append("🐦 and more");
        String cut = AddText.clean(long_);
        assertEquals(AddText.MAX_LENGTH - 1, cut.length());
        StringBuilder huge = new StringBuilder();
        while (huge.length() < 1_000_000) huge.append("word ");
        assertEquals(AddText.MAX_LENGTH - 1, AddText.clean(huge).length());
        // The first cut, too, never leaves half an emoji, even when cleaning then leaves little.
        StringBuilder crafted = new StringBuilder("ok ");
        while (crafted.length() < 4 * AddText.MAX_LENGTH - 1) crafted.append('\u0007');
        crafted.append("🐦 tail");
        assertEquals("ok", AddText.clean(crafted));
    }

    /** Taken once, and forgotten when the add field never asked. */
    @Test
    public void takenOnceAndNotKeptForever() {
        AddText.put("Water plants", 1000);
        assertEquals("Water plants", AddText.take(2000));
        assertNull(AddText.take(2000));
        AddText.put("Stale", 1000);
        assertNull(AddText.take(1000 + AddText.KEPT_MS + 1));
    }
}
