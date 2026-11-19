package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NotificationTokenTest {

    /** Only this install's own token lets a notification's page and action through (ShellPlugin.opened). */
    @Test
    public void onlyTheSameTokenMatches() {
        String token = "0123456789abcdef0123456789abcdef";
        assertTrue(NotificationToken.matches(token, "0123456789abcdef0123456789abcdef"));
        assertFalse(NotificationToken.matches(token, "0123456789abcdef0123456789abcdee"));
        assertFalse(NotificationToken.matches(token, "0123456789abcdef"));
        assertFalse(NotificationToken.matches(token, ""));
        assertFalse(NotificationToken.matches(token, null));
        assertFalse(NotificationToken.matches(null, null));
    }

    /** A thumbs up or dibs button carries its task as an action (Reminders.showNews). */
    @Test
    public void theTaskComesFromThePageAddress() {
        assertEquals("01JTASK", Reminders.taskOf("/lists/L1?task=01JTASK&like=1"));
        assertEquals("01JTASK", Reminders.taskOf("/today?task=01JTASK"));
        assertEquals("01JTASK", Reminders.taskOf("/lists/L1?x=1&task=01JTASK"));
        assertNull(Reminders.taskOf("/lists/L1?task=../admin"));
        assertNull(Reminders.taskOf("/lists/L1?subtask=01JTASK"));
        assertNull(Reminders.taskOf("/lists/L1"));
        assertNull(Reminders.taskOf(null));
    }
}
