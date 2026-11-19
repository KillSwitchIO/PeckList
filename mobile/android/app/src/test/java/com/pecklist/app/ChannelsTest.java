package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.junit.Test;

public class ChannelsTest {

    /**
     * Every channel a notification can go to is made at start, so the phone lists them all before
     * the first of a kind arrives (PL-115: "I should see each of these options").
     */
    @Test
    public void everyChannelANotificationUsesIsMadeAtStart() {
        Set<String> made = new HashSet<>();
        for (Channels.Channel each : Channels.ALL) made.add(each.id);
        for (String kind : new String[] { "assigned", "groupAssigned", "claimed", "shared", "commented", "commentEdited", "mentioned", "" }) {
            assertTrue(kind, made.contains(Reminders.channelOf(kind)));
        }
        assertTrue(made.contains(Reminders.channelFor(new Reminders.Reminder("T@1", "t", "b", 1, "/", false, false))));
        assertTrue(made.contains(Reminders.channelFor(new Reminders.Reminder("T@1", "t", "b", 1, "/", true, false))));
        assertEquals(5, made.size());
    }

    /** Each in-app switch (settings.notifications) has one channel; constant reminders have none of their own. */
    @Test
    public void eachSwitchHasItsChannel() {
        assertEquals(Reminders.CHANNEL, Channels.idOf("reminders"));
        assertEquals(Reminders.ASSIGNMENTS, Channels.idOf("assignments"));
        assertEquals(Reminders.SHARES, Channels.idOf("shares"));
        assertEquals(Reminders.COMMENTS, Channels.idOf("comments"));
        assertEquals(Reminders.CONSTANT, Channels.idOf("constant"));
        assertNull(Channels.idOf("vibrate"));
        assertFalse(Channels.byId(Reminders.CONSTANT).synced());
        assertTrue(Channels.byId(Reminders.COMMENTS).synced());
    }

    /** Two groups: reminders together, and what other people do together. */
    @Test
    public void reminderChannelsAndPeopleChannelsAreGrouped() {
        assertEquals(Channels.GROUP_REMINDERS, Channels.byId(Reminders.CHANNEL).group);
        assertEquals(Channels.GROUP_REMINDERS, Channels.byId(Reminders.CONSTANT).group);
        assertEquals(Channels.GROUP_PEOPLE, Channels.byId(Reminders.ASSIGNMENTS).group);
        assertEquals(Channels.GROUP_PEOPLE, Channels.byId(Reminders.SHARES).group);
        assertEquals(Channels.GROUP_PEOPLE, Channels.byId(Reminders.COMMENTS).group);
    }

    /** A channel switched on the phone is a change the web app carries into its switch. */
    @Test
    public void aChannelSwitchedOnThePhoneIsAChange() {
        Map<String, Boolean> changed = Channels.changes(on("reminders", true, "comments", true), on("reminders", true, "comments", false));
        assertEquals(on("comments", false), changed);
        assertEquals(on("comments", true), Channels.changes(on("comments", false), on("comments", true)));
    }

    /**
     * Only a change counts: a channel off all along never turns off a switch the person turned on in
     * the web app, and the first look is a starting point.
     */
    @Test
    public void aChannelOffAllAlongIsNoChange() {
        assertTrue(Channels.changes(on("comments", false), on("comments", false)).isEmpty());
        assertTrue(Channels.changes(new LinkedHashMap<>(), on("comments", false, "shares", true)).isEmpty());
    }

    /** Constant reminders have no in-app switch: their channel is never carried over. */
    @Test
    public void theConstantChannelIsNotCarriedOver() {
        assertTrue(Channels.changes(on("constant", true), on("constant", false)).isEmpty());
    }

    private static Map<String, Boolean> on(Object... pairs) {
        Map<String, Boolean> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], (Boolean) pairs[i + 1]);
        return map;
    }
}
