package com.pecklist.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Test;

public class WidgetLayoutsTest {

    /**
     * The launcher inflates a widget's layout in the phone's language, not the app's (PL-148: the
     * count widget said "today" with the app on Deutsch, QA). So the widgets set their text and
     * spoken labels from code, and their layouts hold no strings. The picker's previews are drawn
     * by the system anyway, in its own language.
     */
    @Test
    public void widgetLayoutsHoldNoStrings() throws Exception {
        File[] layouts = new File("src/main/res/layout").listFiles(
            (folder, name) -> name.startsWith("widget_") && name.endsWith(".xml") && !name.endsWith("_preview.xml"));
        assertTrue(layouts != null && layouts.length >= 4);
        for (File layout : layouts) {
            String xml = new String(Files.readAllBytes(layout.toPath()), StandardCharsets.UTF_8);
            assertFalse(layout.getName() + " sets a string in XML", xml.contains("@string/"));
        }
    }
}
