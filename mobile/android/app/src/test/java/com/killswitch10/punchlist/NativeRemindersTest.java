package com.killswitch10.punchlist;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class NativeRemindersTest {

    /** The same ids as the web app's idOf() (web/src/adapters/capacitor-notifier.ts), or a reminder set by both would show twice. */
    @Test
    public void idsMatchTheWebApp() {
        assertEquals(153274604, NativeReminders.idOf("T1@1793037600000"));
        assertEquals(779024919, NativeReminders.idOf("01JBXYZ@1700000000000"));
        assertEquals(798184953, NativeReminders.idOf("news:01K8ABCDEF"));
    }
}
