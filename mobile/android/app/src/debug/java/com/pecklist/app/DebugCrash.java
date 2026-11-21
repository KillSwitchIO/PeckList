package com.pecklist.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;

/**
 * Debug builds only (src/debug, PL-116): makes the app go down the way a real fault would, so QA
 * can check the report the next start offers for each kind. Reached only through adb (see the
 * debug manifest). Kinds:
 * - java: an uncaught exception on the main thread, kept by Usage's handler.
 * - anr: the main thread stops answering; the system records an ANR once it gives up waiting.
 * - native: SIGABRT, so debuggerd writes a tombstone (REASON_CRASH_NATIVE).
 */
public class DebugCrash extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String kind = intent.getStringExtra("kind");
        if (kind == null) kind = "java";
        Handler main = new Handler(Looper.getMainLooper());
        switch (kind) {
            case "anr":
                // Longer than any broadcast or input timeout: a tap on the app during it, or the
                // broadcast's own 60 s, makes the system call it an ANR.
                main.post(() -> {
                    try {
                        Thread.sleep(90_000);
                    } catch (InterruptedException ignored) {
                        Thread.currentThread().interrupt();
                    }
                });
                break;
            case "native":
                main.post(() -> Process.sendSignal(Process.myPid(), 6));
                break;
            default:
                // A broadcast may start the process without MainActivity, which sets the handler.
                Usage.watchForCrashes(context);
                main.post(() -> {
                    throw new IllegalStateException("PeckList debug crash (PL-116)");
                });
        }
    }
}
