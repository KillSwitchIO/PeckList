package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.Test;

public class RemindersTest {

    /** The same ids as the web app's idOf() (web/src/adapters/capacitor-notifier.ts), or a reminder set by both would show twice. */
    @Test
    public void idsMatchTheWebApp() {
        assertEquals(153274604, Reminders.idOf("T1@1793037600000"));
        assertEquals(779024919, Reminders.idOf("01JBXYZ@1700000000000"));
        assertEquals(798184953, Reminders.idOf("news:01K8ABCDEF"));
    }

    /** Keys as web/src/core/reminders.ts makes them: the buttons need the task and the first time back. */
    @Test
    public void aKeyNamesItsTaskAndFirstTime() {
        Reminders.Reminder repeat = new Reminders.Reminder("01JTASK@1793037600000#3", "t", "b", 1793038500000L, "/today", true, false);
        assertEquals("01JTASK", repeat.taskId());
        assertEquals(1793037600000L, repeat.first());
        assertEquals("01JTASK@1793037600000", repeat.tag());
        // Repeats replace each other on screen; each has its own alarm.
        assertEquals(Reminders.idOf("01JTASK@1793037600000"), repeat.shown());
        assertEquals(Reminders.idOf("01JTASK@1793037600000#3"), repeat.alarm());
    }

    /**
     * Ben, 0.13.0: a constant reminder rang until touched when it should only buzz. FLAG_INSISTENT
     * repeats the channel's sound too, so it goes on its own channel made with no sound.
     */
    @Test
    public void aConstantReminderBuzzesOnASoundlessChannel() {
        Reminders.Reminder constant = new Reminders.Reminder("T1@1793037600000", "t", "b", 1793037600000L, "/today", true, false);
        assertEquals(Reminders.CONSTANT, Reminders.channelFor(constant));
        assertTrue(Reminders.insistent(constant));
        assertTrue(Reminders.soundless(Reminders.channelFor(constant)));

        // Its quiet copy after 30 minutes replaces it on the same channel, and stops repeating.
        Reminders.Reminder quiet = new Reminders.Reminder("T1@1793037600000" + Reminders.QUIET, "t", "b",
            1793037600000L + Reminders.QUIET_AFTER_MS, "/today", true, false);
        assertEquals(Reminders.CONSTANT, Reminders.channelFor(quiet));
        assertFalse(Reminders.insistent(quiet));
        assertEquals(constant.shown(), quiet.shown());

        // Other reminders keep the Reminders channel and its sound, alerting once.
        Reminders.Reminder plain = new Reminders.Reminder("T2@1793037600000", "t", "b", 1793037600000L, "/today", false, false);
        assertEquals(Reminders.CHANNEL, Reminders.channelFor(plain));
        assertFalse(Reminders.insistent(plain));
        assertFalse(Reminders.soundless(Reminders.CHANNEL));
        for (String news : Arrays.asList(Reminders.ASSIGNMENTS, Reminders.SHARES, Reminders.COMMENTS)) {
            assertFalse(Reminders.soundless(news));
        }
    }

    private static Reminders.Reminder at(String key, long at, boolean local) {
        return new Reminders.Reminder(key, "t", "b", at, "/today", false, false, local);
    }

    /** Audit E2: a check-in knows only the server's reminders; one for a task not synced yet stays. */
    @Test
    public void aCheckInKeepsRemindersForTasksTheServerHasNotHadYet() {
        long now = 1_000_000L;
        List<Reminders.Reminder> current = Arrays.asList(
            at("SYNCED@1", now + 60_000, false),
            at("OFFLINE@1", now + 60_000, true),
            at("OFFLINE-PAST@1", now - 60_000, true),
            at("QUIET@1#quiet", now + 60_000, false));
        List<Reminders.Reminder> server = Collections.singletonList(at("OTHER@1", now + 120_000, false));

        Map<String, Reminders.Reminder> checkIn = Reminders.merge(current, server, true, now);
        assertEquals(Arrays.asList("OFFLINE@1", "QUIET@1#quiet", "OTHER@1"), new java.util.ArrayList<>(checkIn.keySet()));

        // The web app's own list replaces everything but this phone's quiet copies.
        Map<String, Reminders.Reminder> fromApp = Reminders.merge(current, server, false, now);
        assertEquals(Arrays.asList("QUIET@1#quiet", "OTHER@1"), new java.util.ArrayList<>(fromApp.keySet()));

        // Once synced, the server lists it and its copy wins.
        Map<String, Reminders.Reminder> synced = Reminders.merge(current,
            Collections.singletonList(at("OFFLINE@1", now + 60_000, false)), true, now);
        assertEquals(false, synced.get("OFFLINE@1").local);
    }
}
