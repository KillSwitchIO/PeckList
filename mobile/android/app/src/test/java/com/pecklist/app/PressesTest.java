package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class PressesTest {

    /** A press handed back after its process died is not a second press. */
    @Test
    public void aPressCountsOnce() {
        String after = Presses.remember("", "a");
        assertEquals("a", after);
        assertNull(Presses.remember(after, "a"));
    }

    /** A later press of another notification still counts, and the first stays handled. */
    @Test
    public void anotherPressStillCounts() {
        String after = Presses.remember(Presses.remember("", "a"), "b");
        assertEquals("a,b", after);
        assertNull(Presses.remember(after, "a"));
        assertNotNull(Presses.remember(after, "c"));
    }

    /** The list stays small, and the oldest id is the one that goes. */
    @Test
    public void onlyTheNewestAreKept() {
        String stored = "";
        for (int i = 0; i < Presses.KEEP + 8; i++) stored = Presses.remember(stored, "id" + i);
        assertEquals(Presses.KEEP, stored.split(",").length);
        assertNull(Presses.remember(stored, "id" + (Presses.KEEP + 7)));
        assertNull(Presses.remember(stored, "id8"));
        assertNotNull(Presses.remember(stored, "id7"));
    }

    /** A notification from before ids: the same one is recognised, another is not, commas or not. */
    @Test
    public void anOlderNotificationHasAStableId() {
        String one = Presses.idFrom("OPEN.1", null, "/today?task=a,b&like=1");
        assertEquals(one, Presses.idFrom("OPEN.1", null, "/today?task=a,b&like=1"));
        assertNotEquals(one, Presses.idFrom("OPEN.2", null, "/today?task=a,b&like=1"));
        assertEquals(1, one.split(",").length);
    }

    /** The same notification shown again gets a new id, so its next press counts. */
    @Test
    public void eachIdIsNew() {
        assertNotEquals(Presses.newId(), Presses.newId());
    }
}
