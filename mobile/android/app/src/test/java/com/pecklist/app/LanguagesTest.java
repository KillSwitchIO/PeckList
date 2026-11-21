package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Test;

public class LanguagesTest {

    /** The web app's settings.language as it comes: a BCP 47 tag, or nothing for automatic. */
    @Test
    public void aTagIsTakenAsItComes() {
        assertEquals("de", Languages.tagOf("de"));
        assertEquals("pt-BR", Languages.tagOf("pt-BR"));
        assertEquals("zh-Hant-TW", Languages.tagOf(" zh-Hant-TW "));
    }

    /** Nothing, empty, or anything the schema would refuse is automatic: the phone's own languages. */
    @Test
    public void nothingOrAMalformedTagIsAutomatic() {
        assertNull(Languages.tagOf(null));
        assertNull(Languages.tagOf(""));
        assertNull(Languages.tagOf("auto"));
        assertNull(Languages.tagOf("DE"));
        assertNull(Languages.tagOf("de_DE"));
        assertNull(Languages.tagOf("de-" + "x".repeat(40)));
    }

    /**
     * Only a different choice switches anything. Automatic handed over again (every start of a web
     * app on automatic) leaves alone a language the person picked in the phone's own settings.
     */
    @Test
    public void onlyADifferentChoiceSwitches() {
        assertFalse(Languages.changes(null, null));
        assertFalse(Languages.changes("de", "de"));
        assertTrue(Languages.changes(null, "de"));
        assertTrue(Languages.changes("de", "fr"));
        assertTrue(Languages.changes("de", null));
    }

    /**
     * The check-in asks the server for reminders in the app's languages, so a phone on automatic
     * gets them in its own language, not English (Dev 1, PL-148 piece 5).
     */
    @Test
    public void theAppsLanguagesBecomeAnAcceptLanguageHeader() {
        assertEquals("de-AT", Languages.headerOf("de-AT"));
        assertEquals("de-AT,en-US;q=0.9,fr;q=0.8", Languages.headerOf("de-AT,en-US,fr"));
        assertEquals("a,b;q=0.9,c;q=0.8,d;q=0.7,e;q=0.6", Languages.headerOf("a,b,c,d,e,f,g"));
        assertEquals("en", Languages.headerOf(""));
        assertEquals("en", Languages.headerOf("und"));
        assertEquals("en", Languages.headerOf(null));
    }

    /**
     * English is the language of res/values, so the phone's language list (generated from res/values-*)
     * names it: without it Android 13 would offer no English in the app's Language page.
     */
    @Test
    public void theUnqualifiedStringsAreEnglish() throws Exception {
        String properties = new String(
            Files.readAllBytes(new File("src/main/res/resources.properties").toPath()), StandardCharsets.UTF_8);
        assertTrue(properties, properties.contains("unqualifiedResLocale=en-US"));
    }
}
