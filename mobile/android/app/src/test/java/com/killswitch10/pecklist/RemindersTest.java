package com.killswitch10.pecklist;

import static org.junit.Assert.assertEquals;

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
}
