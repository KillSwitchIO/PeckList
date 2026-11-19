package com.pecklist.app;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** The "Add task" Quick Settings tile (PL-113): a task by voice, from anywhere (AddTextActivity). */
public class AddTileService extends TileService {

    @Override
    public void onStartListening() {
        Tile tile = getQsTile();
        if (tile == null) return;
        tile.setState(Tile.STATE_INACTIVE);
        tile.updateTile();
    }

    @Override
    public void onClick() {
        Intent voice = new Intent(AddTextActivity.ACTION_VOICE, null, this, AddTextActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (Build.VERSION.SDK_INT >= 34) {
            // On a locked phone the system asks for the unlock first, then starts it.
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, voice, PendingIntent.FLAG_IMMUTABLE));
        } else if (isLocked()) {
            // The app does not show over the lock screen: unlock, then speak.
            unlockAndRun(() -> startVoiceBefore34(voice));
        } else {
            startVoiceBefore34(voice);
        }
    }

    // Before Android 14 there is only the Intent form; the PendingIntent one is used from 14 (onClick).
    @SuppressLint("StartActivityAndCollapseDeprecated")
    @SuppressWarnings("deprecation")
    private void startVoiceBefore34(Intent voice) {
        startActivityAndCollapse(voice);
    }
}
