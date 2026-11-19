package com.pecklist.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import com.getcapacitor.Logger;

/**
 * Wakes for the background check-in (BackgroundCheck), and after a restart or an app update, which
 * clear alarms, sets it and the reminders (Reminders) again. So too when exact alarms are allowed
 * (ExactAlarms): the ones set inexact before become exact.
 */
public class CheckReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        // The check-in before a reminder: the regular one keeps its time; with the app on screen
        // the web app owns the reminders. Its hand-over sets the next one (Reminders.save).
        boolean before = BackgroundCheck.BEFORE.equals(intent.getAction());
        if (before && MainActivity.showing()) return;
        // The next one first, so a failed check never ends the chain.
        if (!before) BackgroundCheck.schedule(context);
        if (!before && !BackgroundCheck.ACTION.equals(intent.getAction())) {
            Reminders.restore(context);
            return;
        }
        PendingResult pending = goAsync();
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                BackgroundCheck.run(app);
            } catch (Exception error) {
                Logger.warn("PeckList: background check failed: " + error);
            } finally {
                // Again, now that this one's outcome is known: stopped after a sign-out, or later
                // after a failure (audit E1).
                if (!before) BackgroundCheck.schedule(app);
                pending.finish();
            }
        }, "pecklist-check").start();
    }
}
