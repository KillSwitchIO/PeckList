package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import androidx.test.core.app.ApplicationProvider;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * The native store's cases (PL-070), on real SQLite: in the JVM through Robolectric
 * ({@code NativeStoreTest}) and on a phone or emulator ({@code NativeStoreDeviceTest}). The web
 * half's contract is {@code web/src/adapters/native-storage.test.ts}.
 */
public abstract class NativeStoreCases {

    private static final String A = "https://localhost";
    private static final String B = "https://pecklist.example.com";

    private Context context;
    private String name;
    private NativeStore store;

    @Before
    public void open() {
        context = ApplicationProvider.getApplicationContext();
        name = "native-store-test-" + System.nanoTime() + ".db";
        store = new NativeStore(context, name);
    }

    @After
    public void close() {
        store.close();
        context.deleteDatabase(name);
    }

    private static NativeStore.Save save(String header, String... puts) {
        NativeStore.Save save = new NativeStore.Save();
        save.header = header;
        for (int index = 0; index < puts.length; index += 2) save.puts.add(new String[] { puts[index], puts[index + 1] });
        return save;
    }

    private List<String> rows(String ns) {
        List<String> rows = new ArrayList<>();
        String after = null;
        do {
            NativeStore.Page page = store.load(ns, after, NativeStore.PAGE_BYTES);
            for (String[] row : page.rows) rows.add(row[0] + "=" + row[1]);
            after = page.next;
        } while (after != null);
        return rows;
    }

    @Test
    public void loadsNothingWhenNothingWasSaved() {
        NativeStore.Page page = store.load(A, null, NativeStore.PAGE_BYTES);
        assertNull(page.header);
        assertTrue(page.rows.isEmpty());
        assertNull(page.next);
    }

    @Test
    public void roundTripsEntitiesInKeyOrderAndTheHeader() throws Exception {
        store.save(A, save("{\"h\":1}", "tasks/B", "{\"id\":\"B\"}", "lists/A", "{\"id\":\"A\"}"));
        NativeStore.Page page = store.load(A, null, NativeStore.PAGE_BYTES);
        assertEquals("{\"h\":1}", page.header);
        assertEquals(Arrays.asList("lists/A={\"id\":\"A\"}", "tasks/B={\"id\":\"B\"}"), rows(A));
        assertEquals("{\"h\":1}", store.load(A, null, 0).header);
        assertTrue(store.load(A, null, 0).rows.isEmpty());
    }

    @Test
    public void aSaveWritesWhatItNamesAndKeepsTheRest() throws Exception {
        store.save(A, save("{\"h\":1}", "tasks/1", "one", "tasks/2", "two", "tasks/3", "three"));
        NativeStore.Save next = save(null, "tasks/2", "TWO");
        next.deletes.add("tasks/3");
        next.deletes.add("tasks/never");
        store.save(A, next);
        assertEquals(Arrays.asList("tasks/1=one", "tasks/2=TWO"), rows(A));
        assertEquals("{\"h\":1}", store.load(A, null, 0).header);
    }

    @Test
    public void aReplacingSaveDropsWhatItDoesNotPut() throws Exception {
        store.save(A, save("{\"h\":1}", "tasks/1", "one", "tasks/2", "two"));
        NativeStore.Save replace = save("{\"h\":2}", "tasks/3", "three");
        replace.replace = true;
        store.save(A, replace);
        assertEquals(Collections.singletonList("tasks/3=three"), rows(A));
        assertEquals("{\"h\":2}", store.load(A, null, 0).header);
    }

    @Test
    public void aSaveThatFailsPartwayLeavesTheOneBefore() throws Exception {
        store.save(A, save("{\"h\":1}", "tasks/1", "one"));
        // The second put has no value: SQLite refuses it after the first is written, as a crash
        // partway would stop it. The transaction never commits.
        NativeStore.Save broken = save("{\"h\":2}", "tasks/1", "ONE", "tasks/2", null);
        assertThrows(RuntimeException.class, () -> store.save(A, broken));
        assertEquals(Collections.singletonList("tasks/1=one"), rows(A));
        assertEquals("{\"h\":1}", store.load(A, null, 0).header);
    }

    @Test
    public void clearKeepsBackupsAndMetadataAndWipeTakesEverything() throws Exception {
        store.save(A, save("{\"h\":1}", "tasks/1", "one"));
        store.put(A, Arrays.asList(new String[] { "meta:sync", "{\"cursor\":8}" }, new String[] { "backup:v1", "{}" }));
        store.clear(A);
        assertNull(store.load(A, null, 0).header);
        assertTrue(rows(A).isEmpty());
        assertEquals("{\"cursor\":8}", store.get(A, "meta:sync"));
        store.save(A, save("{\"h\":1}", "tasks/1", "one"));
        store.wipe(A);
        assertNull(store.load(A, null, 0).header);
        assertTrue(rows(A).isEmpty());
        assertNull(store.get(A, "meta:sync"));
        assertNull(store.get(A, "backup:v1"));
    }

    @Test
    public void keepsNamespacesApart() throws Exception {
        store.save(A, save("{\"a\":1}", "tasks/1", "phone"));
        store.put(A, Collections.singletonList(new String[] { "meta:sync", "a" }));
        store.save(B, save("{\"b\":1}", "tasks/1", "server"));
        store.wipe(B);
        assertEquals(Collections.singletonList("tasks/1=phone"), rows(A));
        assertEquals("{\"a\":1}", store.load(A, null, 0).header);
        assertEquals("a", store.get(A, "meta:sync"));
        assertNull(store.load(B, null, 0).header);
    }

    @Test
    public void putsAndRemovesMetadataTogether() {
        store.put(A, Collections.singletonList(new String[] { "meta:migrating", "true" }));
        store.put(A, Arrays.asList(new String[] { "meta:movedFromWebView", "true" }, new String[] { "meta:migrating", null }));
        assertEquals("true", store.get(A, "meta:movedFromWebView"));
        assertNull(store.get(A, "meta:migrating"));
    }

    @Test
    public void listsKeysByPrefixTakingUnderscoreAndPercentLiterally() {
        store.put(A, Arrays.asList(new String[] { "backup:a_b", "1" }, new String[] { "backup:a%c", "2" },
            new String[] { "backup:axb", "3" }, new String[] { "meta:x", "4" }));
        assertEquals(Collections.singletonList("backup:a_b"), store.keys(A, "backup:a_"));
        assertEquals(Collections.singletonList("backup:a%c"), store.keys(A, "backup:a%"));
        assertEquals(Arrays.asList("backup:a%c", "backup:a_b", "backup:axb"), store.keys(A, "backup:"));
        assertEquals(4, store.keys(A, "").size());
    }

    @Test
    public void readsTheWholeStoreAsOneJsonTextWithEachRowAsSaved() throws Exception {
        assertEquals("{\"header\":null,\"rows\":[]}", whole(A));
        store.save(A, save("{\"doc\":{\"v\":1},\"order\":{}}", "tasks/B", "{\"id\":\"B\",\"t\":\"say \\\"hi\\\" é\"}",
            "lists/A", "{\"id\":\"A\"}"));
        store.save(B, save("{\"other\":true}", "tasks/C", "{\"id\":\"C\"}"));
        String text = whole(A);
        assertEquals("{\"header\":{\"doc\":{\"v\":1},\"order\":{}},\"rows\":[[\"lists/A\",{\"id\":\"A\"}],"
            + "[\"tasks/B\",{\"id\":\"B\",\"t\":\"say \\\"hi\\\" é\"}]]}", text);
        org.json.JSONObject parsed = new org.json.JSONObject(text);
        assertEquals("say \"hi\" é", parsed.getJSONArray("rows").getJSONArray(1).getJSONObject(1).getString("t"));
        assertEquals("{\"header\":{\"other\":true},\"rows\":[[\"tasks/C\",{\"id\":\"C\"}]]}", whole(B));
        store.clear(A);
        assertEquals("{\"header\":null,\"rows\":[]}", whole(A));
    }

    @Test
    public void readsTenMegabytesWholeInOneText() throws Exception {
        char[] filler = new char[2000];
        Arrays.fill(filler, 'x');
        String body = "\"" + new String(filler) + "\"";
        NativeStore.Save big = save("{\"h\":1}");
        for (int index = 0; index < 5000; index++) big.puts.add(new String[] { String.format("tasks/%05d", index), body });
        store.save(A, big);
        org.json.JSONObject parsed = new org.json.JSONObject(whole(A));
        assertEquals(5000, parsed.getJSONArray("rows").length());
        assertEquals("tasks/04999", parsed.getJSONArray("rows").getJSONArray(4999).getString(0));
    }

    private String whole(String ns) {
        return new String(store.whole(ns), java.nio.charset.StandardCharsets.UTF_8);
    }

    @Test
    public void loadsTenMegabytesInPages() throws Exception {
        char[] filler = new char[2000];
        Arrays.fill(filler, 'x');
        String body = new String(filler);
        NativeStore.Save big = save("{\"h\":1}");
        for (int index = 0; index < 5000; index++) big.puts.add(new String[] { String.format("tasks/%05d", index), body });
        store.save(A, big);
        int pages = 0;
        int seen = 0;
        String after = null;
        do {
            NativeStore.Page page = store.load(A, after, NativeStore.PAGE_BYTES);
            assertEquals(after == null ? "{\"h\":1}" : null, page.header);
            long size = 0;
            for (String[] row : page.rows) size += row[0].length() + row[1].length();
            assertTrue("a page stays near the budget", size < NativeStore.PAGE_BYTES + 2100);
            seen += page.rows.size();
            pages++;
            after = page.next;
        } while (after != null);
        assertEquals(5000, seen);
        assertTrue(pages >= 10);
    }

    @Test
    public void aChunkedSaveShowsNothingUntilItsLastChunk() throws Exception {
        store.save(A, save("{\"h\":1}", "tasks/old", "old"));
        NativeStore.Save first = save(null, "tasks/1", "one", "tasks/2", "two");
        first.stage = "S1";
        first.commit = false;
        first.replace = true;
        store.save(A, first);
        assertEquals(Collections.singletonList("tasks/old=old"), rows(A));
        NativeStore.Save last = save("{\"h\":2}", "tasks/3", "three");
        last.deletes.add("tasks/2");
        last.stage = "S1";
        last.commit = true;
        last.replace = true;
        last.staged = 2;
        store.save(A, last);
        assertEquals(Arrays.asList("tasks/1=one", "tasks/3=three"), rows(A));
        assertEquals("{\"h\":2}", store.load(A, null, 0).header);
        // Nothing staged is left behind.
        NativeStore.Save again = save(null, "tasks/4", "four");
        again.stage = "S2";
        again.staged = 0;
        store.save(A, again);
        assertEquals(3, rows(A).size());
    }

    @Test
    public void aLastChunkWhoseEarlierChunksAreGoneWritesNothing() throws Exception {
        store.save(A, save("{\"h\":1}", "tasks/old", "old"));
        NativeStore.Save first = save(null, "tasks/1", "one");
        first.stage = "S1";
        first.commit = false;
        store.save(A, first);
        // Another save's chunk came between: S1's chunk is dropped.
        NativeStore.Save other = save(null, "tasks/9", "nine");
        other.stage = "S2";
        other.commit = false;
        store.save(A, other);
        NativeStore.Save last = save("{\"h\":2}", "tasks/2", "two");
        last.stage = "S1";
        last.commit = true;
        last.staged = 1;
        assertThrows(NativeStore.StageLost.class, () -> store.save(A, last));
        assertEquals(Collections.singletonList("tasks/old=old"), rows(A));
        assertEquals("{\"h\":1}", store.load(A, null, 0).header);
    }

    @Test
    public void keepsWhatItSavedAcrossAReopen() throws Exception {
        store.save(A, save("{\"h\":1}", "tasks/1", "one"));
        store.put(A, Collections.singletonList(new String[] { "meta:sync", "s" }));
        store.close();
        store = new NativeStore(context, name);
        assertEquals(Collections.singletonList("tasks/1=one"), rows(A));
        assertEquals("s", store.get(A, "meta:sync"));
    }

    @Test
    public void answersOnlyThePagesOwnOriginWhenItIsTheAppsOrTheServers() {
        String local = "https://localhost";
        String server = "https://pecklist.example.com";
        assertEquals(local, NativeStore.namespace("https://localhost", "https://localhost/today", local, null));
        assertEquals(local, NativeStore.namespace("https://localhost", "https://localhost/", local, server));
        assertEquals(server, NativeStore.namespace("https://PeckList.example.com:443", "https://pecklist.example.com/lists/1", local, server));
        // A LAN server over plain http.
        assertEquals("http://10.0.0.5:8080", NativeStore.namespace("http://10.0.0.5:8080", "http://10.0.0.5:8080/", local, "http://10.0.0.5:8080"));
        // A save posted on the server's page and handled after the WebView went to the app's own.
        assertNull(NativeStore.namespace(server, "https://localhost/", local, server));
        assertNull(NativeStore.namespace(local, server + "/", local, server));
        // A page that says it is somewhere it is not, or a provider's page.
        assertNull(NativeStore.namespace("https://localhost", "https://idp.example.com/login", local, server));
        assertNull(NativeStore.namespace("https://idp.example.com", "https://idp.example.com/login", local, server));
        assertNull(NativeStore.namespace(server, server + "/", local, null));
        assertNull(NativeStore.namespace("null", "https://localhost/", local, null));
        assertNull(NativeStore.namespace(null, "https://localhost/", local, null));
        assertNull(NativeStore.namespace(local, null, local, null));
        assertNotNull(NativeStore.namespace(local, "https://localhost", local, null));
        // The shell never holds a server by a Unicode host (it cannot connect to one typed so), so a
        // page's punycode origin is the only form there is to compare.
        assertNull(ServerChoice.normalize("https://bücher.example"));
        assertEquals("https://xn--bcher-kva.example", NativeStore.namespace("https://xn--bcher-kva.example",
            "https://xn--bcher-kva.example/", local, "https://xn--bcher-kva.example"));
    }
}
