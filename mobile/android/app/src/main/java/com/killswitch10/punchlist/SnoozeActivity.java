package com.killswitch10.punchlist;

import android.app.TimePickerDialog;
import android.content.Context;
import android.os.Bundle;
import android.text.format.DateFormat;
import android.widget.Toast;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.Logger;
import java.util.Calendar;
import java.util.Date;
import org.json.JSONObject;

/**
 * Snooze on a reminder asks how long, as TickTick does: a dialog over whatever is on screen, not
 * the app. On a server the choice acts there (ReminderReceiver.press); standalone, the app opens
 * to do it.
 */
public class SnoozeActivity extends AppCompatActivity {

    /** Tomorrow's choice: this time of day. */
    private static final int TOMORROW_HOUR = 9;

    private Reminders.Reminder reminder;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            reminder = Reminders.Reminder.of(new JSONObject(getIntent().getStringExtra(Reminders.EXTRA_REMINDER)));
        } catch (Exception error) {
            finish();
            return;
        }
        int tomorrow = minutesUntilTomorrow();
        int[] minutes = { 10, 30, 60, 180, tomorrow };
        String[] labels = {
            getString(R.string.snooze_minutes, 10),
            getString(R.string.snooze_minutes, 30),
            getString(R.string.snooze_hour),
            getString(R.string.snooze_hours, 3),
            getString(R.string.snooze_tomorrow, clock(System.currentTimeMillis() + tomorrow * 60_000L)),
            getString(R.string.snooze_custom),
        };
        new AlertDialog.Builder(this)
            .setTitle(reminder.title)
            .setItems(labels, (dialog, which) -> {
                if (which < minutes.length) snooze(minutes[which]);
                else pickTime();
            })
            .setOnCancelListener((dialog) -> finish())
            .show();
    }

    /** A time today, or tomorrow when it has passed. */
    private void pickTime() {
        Calendar now = Calendar.getInstance();
        TimePickerDialog picker = new TimePickerDialog(this, (view, hour, minute) -> {
            Calendar at = Calendar.getInstance();
            at.set(Calendar.HOUR_OF_DAY, hour);
            at.set(Calendar.MINUTE, minute);
            at.set(Calendar.SECOND, 0);
            if (at.getTimeInMillis() <= System.currentTimeMillis()) at.add(Calendar.DAY_OF_MONTH, 1);
            snooze((int) Math.max(1, (at.getTimeInMillis() - System.currentTimeMillis() + 59_999) / 60_000));
        }, now.get(Calendar.HOUR_OF_DAY), now.get(Calendar.MINUTE), DateFormat.is24HourFormat(this));
        picker.setOnCancelListener((dialog) -> finish());
        picker.show();
    }

    private void snooze(int minutes) {
        Context app = getApplicationContext();
        if (ServerChoice.get(app) == null) {
            startActivity(Reminders.snoozeInApp(app, reminder, minutes));
            finish();
            return;
        }
        String until = clock(System.currentTimeMillis() + minutes * 60_000L);
        new Thread(() -> {
            try {
                ReminderReceiver.press(app, Reminders.SNOOZE, reminder, minutes);
            } catch (Exception error) {
                Logger.warn("Punchlist: snooze failed: " + error);
            }
        }, "punchlist-snooze").start();
        Toast.makeText(app, getString(R.string.snooze_done, until), Toast.LENGTH_SHORT).show();
        finish();
    }

    private static int minutesUntilTomorrow() {
        Calendar at = Calendar.getInstance();
        at.add(Calendar.DAY_OF_MONTH, 1);
        at.set(Calendar.HOUR_OF_DAY, TOMORROW_HOUR);
        at.set(Calendar.MINUTE, 0);
        at.set(Calendar.SECOND, 0);
        return (int) ((at.getTimeInMillis() - System.currentTimeMillis() + 59_999) / 60_000);
    }

    private String clock(long at) {
        return DateFormat.getTimeFormat(this).format(new Date(at));
    }
}
