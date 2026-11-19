package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class ShortcutsTest {

    /** The static shortcuts' addresses (res/xml/shortcuts.xml) open their pages. */
    @Test
    public void theLongPressShortcutsOpenTheirPages() {
        assertEquals("/today?add=1", Shortcuts.pageOf(Shortcuts.ACTION, "pecklist-shortcut:/today?add=1"));
        assertEquals("/today", Shortcuts.pageOf(Shortcuts.ACTION, "pecklist-shortcut:/today"));
        assertEquals("/search", Shortcuts.pageOf(Shortcuts.ACTION, "pecklist-shortcut:/search"));
        assertEquals("/lists/01JLIST", Shortcuts.pageOf(Shortcuts.ACTION, "pecklist-shortcut:/lists/01JLIST"));
    }

    /** Any app can send the intent (MainActivity is exported): only the known pages, never an address of its choosing. */
    @Test
    public void otherAddressesOpenNothing() {
        assertNull(Shortcuts.pageOf(Shortcuts.ACTION, "pecklist-shortcut://evil.example/today"));
        assertNull(Shortcuts.pageOf(Shortcuts.ACTION, "pecklist-shortcut:/settings/account"));
        assertNull(Shortcuts.pageOf(Shortcuts.ACTION, "pecklist-shortcut:/lists/../admin"));
        assertNull(Shortcuts.pageOf(Shortcuts.ACTION, "pecklist-shortcut:/today?add=1&next=https://evil.example"));
        assertNull(Shortcuts.pageOf(Shortcuts.ACTION, "https://evil.example/today"));
        assertNull(Shortcuts.pageOf("android.intent.action.VIEW", "pecklist-shortcut:/today"));
        assertNull(Shortcuts.pageOf(Shortcuts.ACTION, null));
    }

    /** Each page is reported against its own shortcut, so the launcher ranks by use. */
    @Test
    public void usesAreCountedForTheirShortcut() {
        assertEquals("add-task", Shortcuts.usedId("/today?add=1"));
        assertEquals("today", Shortcuts.usedId("/today"));
        assertEquals("search", Shortcuts.usedId("/search"));
        assertEquals("list:01JLIST", Shortcuts.usedId("/lists/01JLIST"));
    }

    /** One list, the one opened last, within what launchers show; one with no name or an odd id is skipped. */
    @Test
    public void oneListIsKept() {
        List<String[]> kept = Shortcuts.keep(Arrays.asList(
            new String[] { "../x", "Odd" },
            new String[] { "01JA", "  " },
            new String[] { "01JB", " Groceries " },
            new String[] { "01JC", "Work" }));
        assertEquals(1, kept.size());
        assertEquals("01JB", kept.get(0)[0]);
        assertEquals("Groceries", kept.get(0)[1]);
    }
}
