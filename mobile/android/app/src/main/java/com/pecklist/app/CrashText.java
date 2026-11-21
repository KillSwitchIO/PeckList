package com.pecklist.app;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What a crash report may say about a native crash or an ANR the system recorded (PL-116): where
 * the app broke, and nothing about the phone. Android 12 and later hand over a native crash as a
 * protobuf tombstone (debuggerd's tombstone.proto), which also holds the build fingerprint, the
 * SELinux label, registers, memory and every thread; an ANR's trace starts with the same kind of
 * header. Only the signal, the abort message and the crashing thread's top frames are kept, each
 * file by its base name. Plain Java, so it tests without a phone.
 */
final class CrashText {

    /** Frames kept from the crashing thread (or the ANR's main thread). */
    static final int FRAMES = 16;
    /** The longest abort message kept. */
    static final int ABORT = 200;

    private CrashText() {}

    /**
     * A native crash's tombstone as text: "signal 11 (SIGSEGV), code 1 (SEGV_MAPERR)", the abort
     * message, then "#00 pc 0000000000012345 libfoo.so (bar+16)" lines. Empty when it does not read
     * as a tombstone: never the raw bytes.
     */
    static String tombstone(byte[] proto) {
        long crashing = -1;
        byte[] signal = null;
        String abort = null;
        List<byte[]> threads = new ArrayList<>();
        boolean read = false;
        try {
            Reader top = new Reader(proto, 0, proto.length);
            while (top.more()) {
                int key = top.varint32();
                int field = key >>> 3;
                int type = key & 7;
                if (field == 6 && type == 0) crashing = top.varint();
                else if (field == 10 && type == 2) signal = top.bytes();
                else if (field == 14 && type == 2) abort = top.string();
                else if (field == 16 && type == 2) threads.add(top.bytes());
                else top.skip(type);
                read = true;
            }
        } catch (RuntimeException cutShort) {
            // Read only so far (a trace read up to a limit, or not a tombstone at all): keep what
            // came whole before it, and nothing at all from bytes that never read as one.
            if (!read) return "";
        }
        // Every tombstone names its signal: bytes without one are not a tombstone.
        if (signal == null) return "";
        try {
            StringBuilder out = new StringBuilder();
            if (signal != null) out.append(signalLine(signal));
            if (abort != null && !abort.isEmpty()) {
                line(out, "Abort message: " + brief(abort, ABORT));
            }
            for (byte[] entry : threads) {
                byte[] thread = threadOf(entry, crashing);
                if (thread == null) continue;
                for (String frame : frames(thread)) line(out, frame);
                break;
            }
            return out.toString();
        } catch (RuntimeException error) {
            return "";
        }
    }

    /**
     * An ANR's trace as text: the main thread's block alone (its heading and its frames), with
     * each file named by its base name. The header (build fingerprint, command line, ABI), the
     * other threads and the process's memory figures are left out. Empty when no main thread.
     */
    static String anr(String trace) {
        if (trace == null) return "";
        String[] lines = trace.split("\n", -1);
        StringBuilder out = new StringBuilder();
        boolean inMain = false;
        int frames = 0;
        for (String raw : lines) {
            String line = raw.replace("\r", "");
            if (!inMain) {
                if (line.startsWith("\"main\"")) {
                    inMain = true;
                    out.append(printable(line.replaceAll(" sysTid=\\d+", "").replaceAll(" tid=\\d+", "")));
                }
                continue;
            }
            if (line.trim().isEmpty()) break;
            String trimmed = line.trim();
            // Frames only: "at ...", "native: #00 pc ...", "- waiting on ..." and the like.
            if (!(trimmed.startsWith("at ") || trimmed.startsWith("native:") || trimmed.startsWith("- "))) continue;
            if (frames++ >= FRAMES) break;
            // A system library's build id names the exact OS build, as the fingerprint would.
            line(out, "  " + printable(baseNames(BUILD_ID.matcher(trimmed).replaceAll(""))));
        }
        return out.toString();
    }

    private static final Pattern BUILD_ID = Pattern.compile(" ?\\(BuildId: [0-9a-fA-F]*\\)");

    /** The longest exception message kept. */
    static final int MESSAGE = 120;

    /**
     * A Java crash as text, laid out as printStackTrace does (the heading, "at" lines, "Caused by:"
     * and "Suppressed:" with "... n more"), except each message: one line, files by base name,
     * printable only, at most 120 characters. A message can carry anything the code put in it (a
     * parse error quotes its input), so it is cut down; the frames name only the app's code.
     */
    static String java(Throwable error) {
        StringBuilder out = new StringBuilder();
        java(out, error, null, "", "", Collections.newSetFromMap(new IdentityHashMap<>()));
        return out.toString();
    }

    private static void java(StringBuilder out, Throwable error, StackTraceElement[] enclosing, String caption, String prefix, Set<Throwable> seen) {
        if (!seen.add(error)) {
            line(out, prefix + caption + "[circular reference: " + error.getClass().getName() + "]");
            return;
        }
        line(out, prefix + caption + heading(error));
        StackTraceElement[] trace = error.getStackTrace();
        int last = trace.length - 1;
        if (enclosing != null) {
            for (int other = enclosing.length - 1; last >= 0 && other >= 0 && trace[last].equals(enclosing[other]); other--) last--;
        }
        for (int i = 0; i <= last; i++) line(out, prefix + "\tat " + trace[i]);
        int common = trace.length - 1 - last;
        if (common > 0) line(out, prefix + "\t... " + common + " more");
        for (Throwable suppressed : error.getSuppressed()) java(out, suppressed, trace, "Suppressed: ", prefix + "\t", seen);
        Throwable cause = error.getCause();
        if (cause != null) java(out, cause, trace, "Caused by: ", prefix, seen);
    }

    /** "java.lang.IllegalStateException: message", the message cut down; not toString(), which a class may override. */
    private static String heading(Throwable error) {
        String name = error.getClass().getName();
        String message = error.getMessage();
        if (message == null) return name;
        return name + ": " + brief(message, MESSAGE);
    }

    /** Free text the code wrote (a message, an exit description): one line, files by base name, printable, at most max. */
    static String brief(String text, int max) {
        return cut(printable(baseNames(oneLine(text))), max);
    }

    /** A file named by its base name: "/data/app/~~x==/com.app-y==/base.apk" is "base.apk". */
    static String baseName(String path) {
        int slash = path.lastIndexOf('/');
        return slash >= 0 ? path.substring(slash + 1) : path;
    }

    private static final Pattern PATH = Pattern.compile("/[^\\s()]*/([^\\s()/]+)");

    private static String baseNames(String text) {
        Matcher paths = PATH.matcher(text);
        StringBuffer out = new StringBuffer();
        while (paths.find()) paths.appendReplacement(out, Matcher.quoteReplacement(paths.group(1)));
        paths.appendTail(out);
        return out.toString();
    }

    private static String signalLine(byte[] signal) {
        Reader in = new Reader(signal, 0, signal.length);
        long number = 0;
        long code = 0;
        String name = "";
        String codeName = "";
        while (in.more()) {
            int key = in.varint32();
            int field = key >>> 3;
            int type = key & 7;
            if (field == 1 && type == 0) number = in.varint();
            else if (field == 2 && type == 2) name = in.string();
            else if (field == 3 && type == 0) code = in.varint();
            else if (field == 4 && type == 2) codeName = in.string();
            else in.skip(type);
        }
        // Names as debuggerd writes them (SIGSEGV, SEGV_MAPERR), else left out.
        String line = "signal " + (int) number + (SIGNAL_NAME.matcher(name).matches() ? " (" + name + ")" : "");
        return line + ", code " + (int) code + (SIGNAL_NAME.matcher(codeName).matches() ? " (" + codeName + ")" : "");
    }

    /** The map entry's thread (key 1, value 2) when it is the crashing one, else null. */
    private static byte[] threadOf(byte[] entry, long crashing) {
        Reader in = new Reader(entry, 0, entry.length);
        long key = -1;
        byte[] thread = null;
        while (in.more()) {
            int tag = in.varint32();
            int field = tag >>> 3;
            int type = tag & 7;
            if (field == 1 && type == 0) key = in.varint();
            else if (field == 2 && type == 2) thread = in.bytes();
            else in.skip(type);
        }
        return key == crashing ? thread : null;
    }

    private static List<String> frames(byte[] thread) {
        Reader in = new Reader(thread, 0, thread.length);
        List<String> frames = new ArrayList<>();
        while (in.more() && frames.size() < FRAMES) {
            int key = in.varint32();
            int field = key >>> 3;
            int type = key & 7;
            if (field == 4 && type == 2) frames.add(frame(frames.size(), in.bytes()));
            else in.skip(type);
        }
        return frames;
    }

    private static String frame(int index, byte[] frame) {
        Reader in = new Reader(frame, 0, frame.length);
        long relPc = 0;
        long offset = 0;
        String function = "";
        String file = "";
        while (in.more()) {
            int key = in.varint32();
            int field = key >>> 3;
            int type = key & 7;
            if (field == 1 && type == 0) relPc = in.varint();
            else if (field == 4 && type == 2) function = in.string();
            else if (field == 5 && type == 0) offset = in.varint();
            else if (field == 6 && type == 2) file = in.string();
            else in.skip(type);
        }
        String line = String.format("#%02d pc %016x %s", index, relPc, cut(printable(baseName(file)), 80));
        if (!function.isEmpty()) line += " (" + cut(printable(function), 120) + "+" + offset + ")";
        return line;
    }

    private static void line(StringBuilder out, String line) {
        if (out.length() > 0) out.append('\n');
        out.append(line);
    }

    private static final Pattern SIGNAL_NAME = Pattern.compile("[A-Z0-9_]{1,32}");

    /** Printable ASCII only: a stray byte shows as "?", never as itself. */
    private static String printable(String text) {
        return text.replaceAll("[^\\x20-\\x7E]", "?");
    }

    private static String oneLine(String text) {
        return text.replaceAll("\\s+", " ").trim();
    }

    private static String cut(String text, int max) {
        return text.length() > max ? text.substring(0, max) : text;
    }

    /** A protobuf reader over a slice: varints, length-delimited fields, and skipping the rest. */
    private static final class Reader {
        private final byte[] data;
        private int at;
        private final int end;

        Reader(byte[] data, int from, int to) {
            this.data = data;
            this.at = from;
            this.end = to;
        }

        boolean more() {
            return at < end;
        }

        long varint() {
            long value = 0;
            for (int shift = 0; shift < 64; shift += 7) {
                if (at >= end) throw new IllegalArgumentException("cut short");
                byte b = data[at++];
                value |= (long) (b & 0x7f) << shift;
                if ((b & 0x80) == 0) return value;
            }
            throw new IllegalArgumentException("varint too long");
        }

        int varint32() {
            long value = varint();
            if (value < 0 || value > Integer.MAX_VALUE) throw new IllegalArgumentException("bad key");
            return (int) value;
        }

        byte[] bytes() {
            long length = varint();
            if (length < 0 || length > end - at) throw new IllegalArgumentException("bad length");
            byte[] out = java.util.Arrays.copyOfRange(data, at, at + (int) length);
            at += (int) length;
            return out;
        }

        String string() {
            return new String(bytes(), StandardCharsets.UTF_8);
        }

        void skip(int type) {
            switch (type) {
                case 0: varint(); break;
                case 1: advance(8); break;
                case 2: bytes(); break;
                case 5: advance(4); break;
                default: throw new IllegalArgumentException("unknown wire type " + type);
            }
        }

        private void advance(int count) {
            if (count > end - at) throw new IllegalArgumentException("cut short");
            at += count;
        }
    }
}
