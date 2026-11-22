package com.pecklist.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.util.ArrayList;
import java.util.List;

/**
 * The web app's workspace in Android's own SQLite (PL-070, shell api 16), in place of the WebView's
 * IndexedDB: {@code web/src/adapters/native-storage.ts} is the other half. Everything is kept per
 * namespace, the page's origin, as the WebView keeps each origin's storage apart: the bundled
 * "this device only" build and each server the app connects to have their own.
 *
 * <ul>
 *   <li>{@code entities}: one row per entity, keyed {@code collection/id}, as JSON text;</li>
 *   <li>{@code doc}: the workspace minus its entities, with each collection's ids in order, as one
 *       JSON text (the header);</li>
 *   <li>{@code kv}: {@code backup:<name>} and {@code meta:<key>}, as JSON text;</li>
 *   <li>{@code staged}: the chunks of a save too big for one call, until its last chunk commits.</li>
 * </ul>
 *
 * Not thread-safe by itself: the shell runs every call on one serial executor, so saves keep their
 * order and a load after a save sees it.
 */
final class NativeStore {

    static final String DATABASE = "pecklist.db";

    /** Bumped with a change to the tables; {@link Helper#onUpgrade} takes older ones forward. */
    private static final int VERSION = 1;

    /** Rows a load sends per page, by size: a 9 MB workspace never goes as one message. */
    static final int PAGE_BYTES = 1_000_000;

    private final Helper helper;

    NativeStore(Context context) {
        this(context, DATABASE);
    }

    /** {@code name}: null keeps it in memory (tests). */
    NativeStore(Context context, String name) {
        helper = new Helper(context, name);
    }

    void close() {
        helper.close();
    }

    /**
     * The namespace a call may use, or null to refuse it. {@code sent} is the origin the page says
     * it is on, {@code current} the WebView's address as the call is handled: they must be the same
     * origin, so a save the page posted before a navigation and that is handled after it never
     * lands in the next origin's workspace (the page's journal still holds those edits). And it must
     * be the bundled build's own ({@code local}) or the connected server's, so a provider's page
     * shown in the WebView gets nothing. A page can only fail this, never reach another origin.
     */
    static String namespace(String sent, String current, String local, String server) {
        if (sent == null || current == null || !sent.contains("://") || !current.contains("://")) return null;
        String origin = ServerChoice.normalize(sent);
        if (origin == null || !origin.equals(ServerChoice.normalize(current))) return null;
        if (origin.equals(ServerChoice.normalize(local))) return origin;
        return server != null && origin.equals(ServerChoice.normalize(server)) ? origin : null;
    }

    /** A page of a load: the header (on the first page only, null when nothing is saved), rows and where the next page starts. */
    static final class Page {
        final String header;
        final List<String[]> rows;
        /** The key to load after, or null when this was the last page. */
        final String next;

        Page(String header, List<String[]> rows, String next) {
            this.header = header;
            this.rows = rows;
            this.next = next;
        }
    }

    /**
     * The entities after {@code after} (the first page when null, which also has the header), up to
     * about {@code budget} bytes but at least one row. A budget of 0 reads the header alone.
     */
    Page load(String ns, String after, int budget) {
        SQLiteDatabase db = helper.getReadableDatabase();
        String header = null;
        if (after == null) {
            header = header(db, ns);
            if (budget <= 0) return new Page(header, new ArrayList<>(), null);
        }
        List<String[]> rows = new ArrayList<>();
        long size = 0;
        String last = null;
        boolean more = false;
        try (Cursor cursor = db.query("entities", new String[] { "key", "json" },
            after == null ? "ns = ?" : "ns = ? AND key > ?",
            after == null ? new String[] { ns } : new String[] { ns, after },
            null, null, "key")) {
            while (cursor.moveToNext()) {
                if (!rows.isEmpty() && size >= budget) {
                    more = true;
                    break;
                }
                String key = cursor.getString(0);
                String json = cursor.getString(1);
                rows.add(new String[] { key, json });
                size += key.length() + json.length();
                last = key;
            }
        }
        return new Page(header, rows, more ? last : null);
    }

    /**
     * The whole workspace as one JSON text (api 18, PL-149): {"header": the header or null when
     * nothing is saved, "rows": [["collection/id", entity], ...] in key order}. Each stored JSON text
     * goes in as it is, not quoted again, so the page parses it all once ({@link WholeStoreRead}).
     * Written straight out as UTF-8, so it is held once as text rather than as chars, a String and
     * then bytes. The header and the rows are two reads with no transaction around them: what keeps
     * a save from landing between them is that every store call, this one too, runs in turn on
     * {@code ShellPlugin.storeCalls}.
     */
    byte[] whole(String ns) {
        SQLiteDatabase db = helper.getReadableDatabase();
        String header = header(db, ns);
        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream(64 * 1024);
        java.io.PrintWriter out = new java.io.PrintWriter(new java.io.BufferedWriter(
            new java.io.OutputStreamWriter(bytes, java.nio.charset.StandardCharsets.UTF_8)));
        out.append("{\"header\":").append(header == null ? "null" : header).append(",\"rows\":[");
        if (header != null) {
            boolean first = true;
            try (Cursor cursor = db.query("entities", new String[] { "key", "json" }, "ns = ?", new String[] { ns },
                null, null, "key")) {
                while (cursor.moveToNext()) {
                    if (!first) out.append(',');
                    first = false;
                    out.append('[');
                    quote(out, cursor.getString(0)).append(',')
                        .append(cursor.getString(1)).append(']');
                }
            }
        }
        out.append("]}");
        out.flush();
        return bytes.toByteArray();
    }

    /** A key as a JSON string ({@code collection/id}, so nothing to escape in practice, but safe). */
    private static java.io.PrintWriter quote(java.io.PrintWriter out, String text) {
        out.append('"');
        for (int index = 0; index < text.length(); index++) {
            char c = text.charAt(index);
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
            else out.append(c);
        }
        return out.append('"');
    }

    private static String header(SQLiteDatabase db, String ns) {
        try (Cursor cursor = db.query("doc", new String[] { "header" }, "ns = ?", new String[] { ns }, null, null, null)) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }

    /** One save, or one chunk of it (see {@link #save}). */
    static final class Save {
        /** The chunks' shared id when the save comes in more than one call; null for a save in one. */
        String stage;
        /** The last chunk: apply the stage and this call's rows together. Always true without a stage. */
        boolean commit = true;
        /** Every entity not put by this save goes (a save with nothing read before it). */
        boolean replace;
        /** On a commit: how many rows the earlier chunks staged, so a stage that lost some is refused. */
        int staged;
        final List<String[]> puts = new ArrayList<>();
        final List<String> deletes = new ArrayList<>();
        /** The new header, or null to keep the stored one. */
        String header;
    }

    /**
     * Writes a save in one transaction, so a crash leaves this save or the one before, never part
     * of one. A chunk that does not commit only waits in {@code staged}; the commit applies every
     * chunk of its stage (and drops any other stage, left by a page that went away). A commit whose
     * stage does not hold the rows the earlier chunks sent writes nothing and throws.
     */
    void save(String ns, Save save) throws StageLost {
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            if (save.stage != null && !save.commit) {
                stage(db, ns, save);
            } else {
                if (save.replace) db.delete("entities", "ns = ?", new String[] { ns });
                if (save.stage != null) {
                    long have = android.database.DatabaseUtils.queryNumEntries(db, "staged", "ns = ? AND stage = ?",
                        new String[] { ns, save.stage });
                    if (have != save.staged) throw new StageLost();
                    stage(db, ns, save);
                    apply(db, ns, save.stage);
                } else {
                    for (String[] put : save.puts) putEntity(db, ns, put[0], put[1]);
                    for (String key : save.deletes) db.delete("entities", "ns = ? AND key = ?", new String[] { ns, key });
                    if (save.header != null) putHeader(db, ns, save.header);
                }
                db.delete("staged", "ns = ?", new String[] { ns });
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /** A chunked save's earlier chunks are not all there (another save came between them). */
    static final class StageLost extends Exception {
        StageLost() {
            super("the save's earlier chunks are gone");
        }
    }

    private static void stage(SQLiteDatabase db, String ns, Save save) {
        // A chunk of another stage than the one waiting: that one was left by a page that went away.
        db.delete("staged", "ns = ? AND stage <> ?", new String[] { ns, save.stage });
        for (String[] put : save.puts) stageRow(db, ns, save.stage, put[0], put[1]);
        for (String key : save.deletes) stageRow(db, ns, save.stage, key, null);
        if (save.header != null) stageRow(db, ns, save.stage, "", save.header);
    }

    private static void stageRow(SQLiteDatabase db, String ns, String stage, String key, String json) {
        ContentValues values = new ContentValues();
        values.put("ns", ns);
        values.put("stage", stage);
        values.put("key", key);
        if (json == null) values.putNull("json");
        else values.put("json", json);
        db.insertWithOnConflict("staged", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    /** The stage's rows, in the order staged: the empty key is the header, a null json a delete. */
    private static void apply(SQLiteDatabase db, String ns, String stage) {
        try (Cursor cursor = db.query("staged", new String[] { "key", "json" }, "ns = ? AND stage = ?",
            new String[] { ns, stage }, null, null, "rowid")) {
            while (cursor.moveToNext()) {
                String key = cursor.getString(0);
                String json = cursor.isNull(1) ? null : cursor.getString(1);
                if (key.isEmpty()) putHeader(db, ns, json);
                else if (json == null) db.delete("entities", "ns = ? AND key = ?", new String[] { ns, key });
                else putEntity(db, ns, key, json);
            }
        }
    }

    private static void putEntity(SQLiteDatabase db, String ns, String key, String json) {
        ContentValues values = new ContentValues();
        values.put("ns", ns);
        values.put("key", key);
        values.put("json", json);
        db.insertWithOnConflict("entities", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    private static void putHeader(SQLiteDatabase db, String ns, String header) {
        ContentValues values = new ContentValues();
        values.put("ns", ns);
        values.put("header", header);
        db.insertWithOnConflict("doc", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    /** The workspace gone (entities and header); backups and device metadata stay. */
    void clear(String ns) {
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            for (String table : new String[] { "entities", "doc", "staged" }) db.delete(table, "ns = ?", new String[] { ns });
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /** A backup or metadata value ({@code backup:...}, {@code meta:...}), or null. */
    String get(String ns, String key) {
        try (Cursor cursor = helper.getReadableDatabase().query("kv", new String[] { "json" }, "ns = ? AND key = ?",
            new String[] { ns, key }, null, null, null)) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }

    /** Sets (or, with a null value, removes) each key, all in one transaction. */
    void put(String ns, List<String[]> entries) {
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            for (String[] entry : entries) {
                if (entry[1] == null) {
                    db.delete("kv", "ns = ? AND key = ?", new String[] { ns, entry[0] });
                } else {
                    ContentValues values = new ContentValues();
                    values.put("ns", ns);
                    values.put("key", entry[0]);
                    values.put("json", entry[1]);
                    db.insertWithOnConflict("kv", null, values, SQLiteDatabase.CONFLICT_REPLACE);
                }
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /** The backup and metadata keys that start with {@code prefix}, in order. */
    List<String> keys(String ns, String prefix) {
        // A range, not LIKE: keys may hold _ and %.
        List<String> keys = new ArrayList<>();
        try (Cursor cursor = helper.getReadableDatabase().query("kv", new String[] { "key" }, "ns = ? AND key >= ? AND key < ?",
            new String[] { ns, prefix, prefix + new String(Character.toChars(Character.MAX_CODE_POINT)) }, null, null, "key")) {
            while (cursor.moveToNext()) keys.add(cursor.getString(0));
        }
        return keys;
    }

    /** Everything kept under the namespace (signing out, audit W1). */
    void wipe(String ns) {
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            for (String table : new String[] { "entities", "doc", "kv", "staged" }) db.delete(table, "ns = ?", new String[] { ns });
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    private static final class Helper extends SQLiteOpenHelper {
        Helper(Context context, String name) {
            super(context, name, null, VERSION);
            setWriteAheadLoggingEnabled(true);
        }

        @Override
        public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE entities (ns TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (ns, key))");
            db.execSQL("CREATE TABLE doc (ns TEXT NOT NULL PRIMARY KEY, header TEXT NOT NULL)");
            db.execSQL("CREATE TABLE kv (ns TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (ns, key))");
            db.execSQL("CREATE TABLE staged (ns TEXT NOT NULL, stage TEXT NOT NULL, key TEXT NOT NULL, json TEXT, PRIMARY KEY (ns, stage, key))");
        }

        @Override
        public void onUpgrade(SQLiteDatabase db, int from, int to) {
            // Version 1 is the first. A later table change takes each older version forward here,
            // one step at a time, never by dropping what a person has saved.
        }
    }
}
