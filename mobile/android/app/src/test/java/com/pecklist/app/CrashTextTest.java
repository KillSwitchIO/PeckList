package com.pecklist.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Random;
import org.junit.Test;

/**
 * A crash report says where the app broke and nothing about the phone (PL-116, QA 2026-11-21: a
 * native crash's report was its raw protobuf tombstone, with the build fingerprint, SELinux label
 * and registers). The tombstones here are built field by field as debuggerd's tombstone.proto
 * lays them out.
 */
public class CrashTextTest {

    private static final String FINGERPRINT = "google/sdk_gphone64_x86_64/emu64xa:16/BP22.250325.006/13344233:userdebug/dev-keys";
    private static final String SELINUX = "u:r:untrusted_app:s0:c512,c768";

    /** A minimal protobuf writer: varints and length-delimited fields. */
    private static final class Proto {
        private final ByteArrayOutputStream out = new ByteArrayOutputStream();

        Proto varint(int field, long value) {
            key(field, 0);
            raw(value);
            return this;
        }

        Proto bytes(int field, byte[] value) {
            key(field, 2);
            raw(value.length);
            out.write(value, 0, value.length);
            return this;
        }

        Proto string(int field, String value) {
            return bytes(field, value.getBytes(StandardCharsets.UTF_8));
        }

        Proto message(int field, Proto value) {
            return bytes(field, value.build());
        }

        byte[] build() {
            return out.toByteArray();
        }

        private void key(int field, int type) {
            raw(((long) field << 3) | type);
        }

        private void raw(long value) {
            while ((value & ~0x7FL) != 0) {
                out.write((int) ((value & 0x7F) | 0x80));
                value >>>= 7;
            }
            out.write((int) value);
        }
    }

    private static Proto frame(long relPc, String function, long offset, String file) {
        Proto frame = new Proto().varint(1, relPc).varint(2, relPc + 0x7000000000L).varint(3, 0x7ffd1234);
        if (function != null) frame.string(4, function).varint(5, offset);
        return frame.string(6, file).string(8, "0123456789abcdef");
    }

    private static Proto thread(int id, String name, int frames) {
        Proto thread = new Proto().varint(1, id).string(2, name)
            .message(3, new Proto().string(1, "x0").varint(2, 0xdeadbeefL));
        for (int i = 0; i < frames; i++) {
            thread.message(4, frame(0x1000 + i, "fn" + i, i, "/apex/com.android.runtime/lib64/bionic/libc" + i + ".so"));
        }
        return thread.message(5, new Proto().string(1, "x1").bytes(4, new byte[] { 1, 2, 3 }));
    }

    private static Proto threadEntry(int id, Proto thread) {
        return new Proto().varint(1, id).message(2, thread);
    }

    private static byte[] tombstone() {
        return new Proto()
            .varint(1, 3)
            .string(2, FINGERPRINT)
            .string(3, "0")
            .string(4, "2026-11-21 03:01:02.123456789-0600")
            .varint(5, 4242)
            .varint(6, 4250)
            .varint(7, 10512)
            .string(8, SELINUX)
            .string(9, "com.pecklist.app")
            .message(10, new Proto().varint(1, 6).string(2, "SIGABRT").varint(3, -1L & 0xFFFFFFFFL).string(4, "SI_TKILL"))
            .string(14, "Check failed: queue.empty() at /buildbot/src/android/webview/queue.cc:88")
            // Another thread first: the map's order is not the crashing thread's.
            .message(16, threadEntry(4242, thread(4242, "main", 3)))
            .message(16, threadEntry(4250, new Proto().varint(1, 4250).string(2, "RenderThread")
                .message(4, frame(0x4b2c, "abort", 164, "/apex/com.android.runtime/lib64/bionic/libc.so"))
                .message(4, frame(0x9a10, "_ZN7android6Thread11_threadLoopEPv", 296, "/system/lib64/libutils.so"))
                .message(4, frame(0x1234, null, 0, "/data/app/~~Zx9wQ==/com.pecklist.app-AbC12==/base.apk"))
                .message(3, new Proto().string(1, "pc").varint(2, 0x7a1b2c3d4eL))))
            .message(17, new Proto().varint(1, 0x1000).varint(2, 0x2000).string(5, "/data/app/~~Zx9wQ==/com.pecklist.app-AbC12==/base.apk"))
            .build();
    }

    @Test
    public void a_tombstone_gives_the_signal_the_abort_message_and_the_crashing_threads_frames() {
        assertEquals(
            "signal 6 (SIGABRT), code -1 (SI_TKILL)\n"
                + "Abort message: Check failed: queue.empty() at queue.cc:88\n"
                + "#00 pc 0000000000004b2c libc.so (abort+164)\n"
                + "#01 pc 0000000000009a10 libutils.so (_ZN7android6Thread11_threadLoopEPv+296)\n"
                + "#02 pc 0000000000001234 base.apk",
            CrashText.tombstone(tombstone()));
    }

    @Test
    public void nothing_about_the_phone_or_the_other_threads_is_kept() {
        String text = CrashText.tombstone(tombstone());
        for (String never : new String[] {
            FINGERPRINT, "sdk_gphone64", "dev-keys", SELINUX, "untrusted_app", "com.pecklist.app-AbC12", "~~Zx9wQ",
            "/data/app", "/apex", "buildbot", "x0", "pc 0x", "deadbeef", "RenderThread", "main", "fn0", "4242", "2026-11-21",
        }) {
            assertFalse("kept " + never + ": " + text, text.contains(never));
        }
    }

    @Test
    public void at_most_sixteen_frames_are_kept() {
        byte[] proto = new Proto()
            .varint(6, 7)
            .message(10, new Proto().varint(1, 11).string(2, "SIGSEGV").varint(3, 1).string(4, "SEGV_MAPERR"))
            .message(16, threadEntry(7, thread(7, "worker", 40)))
            .build();
        String[] lines = CrashText.tombstone(proto).split("\n");
        assertEquals("signal 11 (SIGSEGV), code 1 (SEGV_MAPERR)", lines[0]);
        assertEquals(1 + CrashText.FRAMES, lines.length);
        assertEquals("#15 pc 000000000000100f libc15.so (fn15+15)", lines[CrashText.FRAMES]);
    }

    @Test
    public void a_tombstone_read_only_so_far_keeps_what_came_whole() {
        byte[] whole = tombstone();
        // Cut inside the memory mappings after the threads: the frames are all there.
        byte[] cut = Arrays.copyOf(whole, whole.length - 10);
        assertTrue(CrashText.tombstone(cut).startsWith("signal 6 (SIGABRT)"));
        assertTrue(CrashText.tombstone(cut).contains("#00 pc 0000000000004b2c libc.so (abort+164)"));
    }

    @Test
    public void bytes_that_are_not_a_tombstone_give_nothing_never_themselves() {
        assertEquals("", CrashText.tombstone(new byte[0]));
        assertEquals("", CrashText.tombstone("*** *** *** Build fingerprint: 'x' *** ***".getBytes(StandardCharsets.UTF_8)));
        Random random = new Random(116);
        for (int i = 0; i < 2000; i++) {
            byte[] noise = new byte[random.nextInt(600)];
            random.nextBytes(noise);
            String text = CrashText.tombstone(noise);
            // Whatever a stray field yields is printable and short: never the bytes as they came.
            assertTrue(text, text.chars().allMatch(c -> c == '\n' || (c >= 0x20 && c <= 0x7E)));
            assertTrue(text.length() < 4096);
        }
    }

    @Test
    public void a_stray_byte_in_a_name_shows_as_a_question_mark() {
        byte[] proto = new Proto()
            .varint(6, 1)
            .message(10, new Proto().varint(1, 11).string(2, "SIG\u0001SEGV").varint(3, 2).string(4, "SEGV_ACCERR"))
            .message(16, threadEntry(1, new Proto().varint(1, 1).message(4, frame(0x10, "f\u0000n", 1, "/x/li\nb.so"))))
            .build();
        assertEquals("signal 11, code 2 (SEGV_ACCERR)\n#00 pc 0000000000000010 li?b.so (f?n+1)", CrashText.tombstone(proto));
    }

    private static final String ANR_TRACE = String.join("\n",
        "",
        "----- pid 4242 at 2026-11-21 03:04:05.678901234-0600 -----",
        "Cmd line: com.pecklist.app",
        "Build fingerprint: '" + FINGERPRINT + "'",
        "ABI: 'x86_64'",
        "Build type: optimized",
        "Heap: 12% free, 9MB/10MB; 123456 objects",
        "",
        "suspend all histogram:\tSum: 1.234ms 99% C.I. 0.5us-12.3us Avg: 1.2us Max: 45us",
        "DALVIK THREADS (24):",
        "\"Signal Catcher\" daemon prio=10 tid=7 Runnable",
        "  at java.lang.Object.wait(Native method)",
        "",
        "\"main\" prio=5 tid=1 Sleeping",
        "  | group=\"main\" sCount=1 ucsCount=0 flags=1 obj=0x72a1b2c3 self=0x7a1b2c3d4e00",
        "  | sysTid=4242 nice=-10 cgrp=top-app sched=0/0 handle=0x7c1d2e3f4a50",
        "  | state=S schedstat=( 123 456 7 ) utm=1 stm=2 core=3 HZ=100",
        "  | stack=0x7ffd1000-0x7ffd3000 stackSize=8188KB",
        "  native: #00 pc 000000000009a1b4  /apex/com.android.runtime/lib64/bionic/libc.so (nanosleep+4) (BuildId: 0123abcd)",
        "  at java.lang.Thread.sleep(Native method)",
        "  - sleeping on <0x0a1b2c3d> (a java.lang.Object)",
        "  at com.pecklist.app.MainActivity.onCreate(MainActivity.java:42)",
        "",
        "\"RenderThread\" daemon prio=7 tid=9 Native",
        "  at android.view.ThreadedRenderer.nSyncAndDrawFrame(Native method)",
        "");

    @Test
    public void an_anr_keeps_the_main_thread_alone_and_no_header() {
        assertEquals(
            "\"main\" prio=5 Sleeping\n"
                + "  native: #00 pc 000000000009a1b4  libc.so (nanosleep+4)\n"
                + "  at java.lang.Thread.sleep(Native method)\n"
                + "  - sleeping on <0x0a1b2c3d> (a java.lang.Object)\n"
                + "  at com.pecklist.app.MainActivity.onCreate(MainActivity.java:42)",
            CrashText.anr(ANR_TRACE));
        String text = CrashText.anr(ANR_TRACE);
        for (String never : new String[] { FINGERPRINT, "Cmd line", "ABI", "Heap", "sysTid", "self=", "RenderThread", "Signal Catcher", "/apex", "BuildId", "0123abcd" }) {
            assertFalse("kept " + never, text.contains(never));
        }
    }

    @Test
    public void an_anr_with_no_main_thread_gives_nothing() {
        assertEquals("", CrashText.anr("Build fingerprint: 'x'\n\"worker\" prio=5 tid=2 Runnable\n  at a.b(c.java:1)\n"));
        assertEquals("", CrashText.anr(null));
    }

    @Test
    public void an_anr_line_with_a_stray_byte_shows_it_as_a_question_mark() {
        assertEquals(
            "\"main\" prio=5 Runnable\n  at a.b(c?.java:1)",
            CrashText.anr("\"main\" prio=5 tid=1 Runnable\n  at a.b(cé.java:1)\n"));
    }

    @Test
    public void free_text_is_one_short_printable_line_without_paths() {
        assertEquals("killed by x? see crash.log", CrashText.brief("killed\n by x\u0001 see /data/user/0/a/crash.log", 200));
        assertEquals("abc", CrashText.brief("abcdef", 3));
    }

    private static StackTraceElement at(String method, int line) {
        return new StackTraceElement("com.pecklist.app.Sync", method, "Sync.java", line);
    }

    @Test
    public void a_java_crash_keeps_its_frames_and_cuts_each_message_down() {
        RuntimeException cause = new NumberFormatException("For input string: \"Buy milk\nfor\tbob@example.com\" at /data/user/0/com.pecklist.app/files/x.json\u0007 line 3");
        cause.setStackTrace(new StackTraceElement[] { at("parse", 30), at("pull", 20), at("run", 10) });
        RuntimeException error = new IllegalStateException("sync failed", cause);
        error.setStackTrace(new StackTraceElement[] { at("pull", 21), at("run", 10) });
        assertEquals(
            "java.lang.IllegalStateException: sync failed\n"
                + "\tat com.pecklist.app.Sync.pull(Sync.java:21)\n"
                + "\tat com.pecklist.app.Sync.run(Sync.java:10)\n"
                + "Caused by: java.lang.NumberFormatException: For input string: \"Buy milk for bob@example.com\" at x.json? line 3\n"
                + "\tat com.pecklist.app.Sync.parse(Sync.java:30)\n"
                + "\tat com.pecklist.app.Sync.pull(Sync.java:20)\n"
                + "\t... 1 more",
            CrashText.java(error));
    }

    @Test
    public void a_java_message_is_at_most_120_characters_and_none_is_none() {
        char[] long_ = new char[500];
        Arrays.fill(long_, 'x');
        RuntimeException error = new RuntimeException(new String(long_));
        error.setStackTrace(new StackTraceElement[0]);
        assertEquals("java.lang.RuntimeException: " + new String(long_, 0, CrashText.MESSAGE), CrashText.java(error));
        RuntimeException bare = new RuntimeException();
        bare.setStackTrace(new StackTraceElement[] { at("run", 10) });
        assertEquals("java.lang.RuntimeException\n\tat com.pecklist.app.Sync.run(Sync.java:10)", CrashText.java(bare));
    }

    @Test
    public void a_java_heading_is_not_the_class_s_own_to_string() {
        RuntimeException error = new RuntimeException("short") {
            @Override
            public String toString() {
                return "everything the class wanted to say about the user";
            }
        };
        error.setStackTrace(new StackTraceElement[0]);
        assertTrue(CrashText.java(error).endsWith(": short"));
        assertFalse(CrashText.java(error).contains("everything"));
    }

    @Test
    public void suppressed_and_circular_causes_end() {
        RuntimeException a = new RuntimeException("a");
        RuntimeException b = new RuntimeException("b", a);
        a.initCause(b);
        a.setStackTrace(new StackTraceElement[] { at("run", 10) });
        b.setStackTrace(new StackTraceElement[] { at("run", 10) });
        RuntimeException closing = new RuntimeException("close");
        closing.setStackTrace(new StackTraceElement[] { at("close", 5), at("run", 10) });
        a.addSuppressed(closing);
        assertEquals(
            "java.lang.RuntimeException: a\n"
                + "\tat com.pecklist.app.Sync.run(Sync.java:10)\n"
                + "\tSuppressed: java.lang.RuntimeException: close\n"
                + "\t\tat com.pecklist.app.Sync.close(Sync.java:5)\n"
                + "\t\t... 1 more\n"
                + "Caused by: java.lang.RuntimeException: b\n"
                + "\t... 1 more\n"
                + "Caused by: [circular reference: java.lang.RuntimeException]",
            CrashText.java(a));
    }
}
