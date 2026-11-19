package com.pecklist.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/**
 * Undo on the Today widget (PL-121): the tick back in sight, nothing sent. Not exported, so only
 * the widget's own PendingIntent reaches it; the widget provider must be exported for the
 * launcher, and any app could have unticked through it (Security 2026-11-19).
 */
public class WidgetUndoReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Widgets.ACTION_UNDO.equals(intent.getAction())) return;
        Uri data = intent.getData();
        String id = data == null ? null : data.getLastPathSegment();
        if (id != null) WidgetStore.untick(context, id);
        Widgets.redraw(context);
    }
}
