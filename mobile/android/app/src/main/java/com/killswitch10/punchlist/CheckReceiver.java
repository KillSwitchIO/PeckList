package com.killswitch10.punchlist;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import com.getcapacitor.Logger;

/**
 * Wakes for the background check-in (BackgroundCheck), and after a restart or an app update, which
 * clear alarms, sets it and the reminders (Reminders) again.
 */
public class CheckReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        // The next one first, so a failed check never ends the chain.
        BackgroundCheck.schedule(context);
        if (!BackgroundCheck.ACTION.equals(intent.getAction())) {
            Reminders.restore(context);
            return;
        }
        PendingResult pending = goAsync();
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                BackgroundCheck.run(app);
            } catch (Exception error) {
                Logger.warn("Punchlist: background check failed: " + error);
            } finally {
                pending.finish();
            }
        }, "punchlist-check").start();
    }
}
