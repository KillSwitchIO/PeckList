package com.pecklist.app;

import android.app.TimePickerDialog;
import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.text.format.DateFormat;
import android.text.format.DateUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CalendarView;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.Logger;
import java.util.Calendar;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.TimeZone;
import org.json.JSONObject;

/**
 * Snooze on a reminder asks until when, in a dialog over whatever is on screen, not the app
 * (PL-145). Delay: quick picks that snooze at once, or a typed amount. Date and time: any minute in
 * the next week (the server's limit). The choice acts without the app (ReminderReceiver.press), and
 * a toast says until when. Back or a tap outside leaves the reminder as it was.
 */
public class SnoozeActivity extends AppCompatActivity {

    private static final String STATE_TAB = "tab";
    private static final String STATE_PICKED = "picked";

    private Reminders.Reminder reminder;
    private AlertDialog dialog;
    private boolean onDateTab;
    private boolean done;
    /** The Date and time tab's choice, to the minute. */
    private final Calendar picked = Calendar.getInstance();
    /** Each quick pick's "until" time, and tomorrow morning's label and moment, kept current. */
    private final List<TextView> quickUntil = new ArrayList<>();
    private TextView tomorrowLabel;
    private long tomorrowAt;
    /** Every new minute, the quick picks' times and the Date and time tab move on. */
    private final Handler ticks = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            showQuickTimes(System.currentTimeMillis());
            refresh();
            scheduleTick();
        }
    };

    private TextView tabDelay;
    private TextView tabAt;
    private View pageDelay;
    private View pageAt;
    private EditText amount;
    private Spinner unit;
    private CalendarView calendar;
    private TextView timeValue;
    private TextView problem;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            reminder = Reminders.Reminder.of(new JSONObject(getIntent().getStringExtra(Reminders.EXTRA_REMINDER)));
        } catch (Exception error) {
            finish();
            return;
        }
        long now = System.currentTimeMillis();
        long first = SnoozeTimes.firstPick(now, TimeZone.getDefault());
        picked.setTimeInMillis(savedInstanceState != null ? savedInstanceState.getLong(STATE_PICKED, first) : first);

        View view = LayoutInflater.from(this).inflate(R.layout.snooze_dialog, null);
        tabDelay = view.findViewById(R.id.snooze_tab_delay);
        tabAt = view.findViewById(R.id.snooze_tab_at);
        pageDelay = view.findViewById(R.id.snooze_page_delay);
        pageAt = view.findViewById(R.id.snooze_page_at);
        amount = view.findViewById(R.id.snooze_amount);
        unit = view.findViewById(R.id.snooze_unit);
        calendar = view.findViewById(R.id.snooze_calendar);
        timeValue = view.findViewById(R.id.snooze_time);
        problem = view.findViewById(R.id.snooze_at_problem);

        addQuickPicks(view.findViewById(R.id.snooze_quick), now);
        ArrayAdapter<CharSequence> units = ArrayAdapter.createFromResource(this, R.array.snooze_units,
            android.R.layout.simple_spinner_item);
        units.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        unit.setAdapter(units);
        unit.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View item, int position, long id) {
                refresh();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {}
        });
        amount.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence text, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence text, int start, int before, int count) {}

            @Override
            public void afterTextChanged(Editable text) {
                refresh();
            }
        });
        amount.setOnEditorActionListener((field, action, event) -> {
            if (action != EditorInfo.IME_ACTION_DONE) return false;
            snoozeChosen();
            return true;
        });
        tabDelay.setOnClickListener((tab) -> showTab(false));
        tabAt.setOnClickListener((tab) -> showTab(true));
        // From today. Later days stay on the calendar: the line under it says how far a snooze can
        // go (a week, the server's limit), and a day past it says so and turns Snooze off.
        calendar.setMinDate(now - 1000);
        calendar.setDate(picked.getTimeInMillis(), false, true);
        calendar.setOnDateChangeListener((day, year, month, date) -> {
            picked.set(year, month, date);
            refresh();
        });
        view.findViewById(R.id.snooze_time_row).setOnClickListener((row) -> pickTime());

        dialog = new AlertDialog.Builder(this)
            .setTitle(reminder.title)
            .setView(view)
            .setPositiveButton(R.string.action_snooze, null)
            .setNegativeButton(android.R.string.cancel, null)
            .create();
        // Closed any way (a choice, Cancel, Back, a tap outside): nothing of this stays on screen.
        dialog.setOnDismissListener((closed) -> finish());
        if (dialog.getWindow() != null) {
            // No keyboard until the amount is tapped.
            dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
        }
        dialog.show();
        // Snooze checks the choice itself, so a choice that does not fit leaves the dialog open.
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener((button) -> snoozeChosen());
        showTab(savedInstanceState != null && savedInstanceState.getBoolean(STATE_TAB));
        scheduleTick();
    }

    private void scheduleTick() {
        long now = System.currentTimeMillis();
        ticks.postDelayed(tick, SnoozeTimes.until(now, 1) - now + 50);
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putBoolean(STATE_TAB, onDateTab);
        state.putLong(STATE_PICKED, picked.getTimeInMillis());
    }

    @Override
    protected void onDestroy() {
        ticks.removeCallbacks(tick);
        if (dialog != null) {
            dialog.setOnDismissListener(null);
            dialog.dismiss();
        }
        super.onDestroy();
    }

    /** Each quick pick, with the time it snoozes until; tomorrow morning last. */
    private void addQuickPicks(ViewGroup list, long now) {
        LayoutInflater inflater = LayoutInflater.from(this);
        for (int minutes : SnoozeTimes.QUICK) {
            String label = minutes < 60 ? getResources().getQuantityString(R.plurals.snooze_minutes, minutes, minutes)
                : getResources().getQuantityString(R.plurals.snooze_hours, minutes / 60, minutes / 60);
            View row = addQuickPick(inflater, list, label);
            quickUntil.add(row.findViewById(R.id.snooze_quick_until));
            // Counted from the tap; the time shown moves on with the clock, so the two agree.
            row.setOnClickListener((tapped) -> snooze(minutes));
        }
        View row = addQuickPick(inflater, list, "");
        tomorrowLabel = row.findViewById(R.id.snooze_quick_label);
        // Until the morning the label names, however long the dialog stood open.
        row.setOnClickListener((tapped) -> snooze((int) Math.max(1, SnoozeTimes.minutesUntil(System.currentTimeMillis(), tomorrowAt))));
        showQuickTimes(now);
    }

    private void showQuickTimes(long now) {
        for (int index = 0; index < quickUntil.size(); index++) {
            quickUntil.get(index).setText(clock(SnoozeTimes.until(now, SnoozeTimes.QUICK[index])));
        }
        tomorrowAt = SnoozeTimes.until(now, SnoozeTimes.tomorrowMorning(now, TimeZone.getDefault()));
        tomorrowLabel.setText(getString(R.string.snooze_tomorrow, DateFormat.getTimeFormat(this).format(new Date(tomorrowAt))));
    }

    private View addQuickPick(LayoutInflater inflater, ViewGroup list, String label) {
        View row = inflater.inflate(R.layout.snooze_quick, list, false);
        ((TextView) row.findViewById(R.id.snooze_quick_label)).setText(label);
        list.addView(row);
        return row;
    }

    private void showTab(boolean dateTab) {
        onDateTab = dateTab;
        tabDelay.setSelected(!dateTab);
        tabAt.setSelected(dateTab);
        // Invisible, not gone: the dialog keeps its size whichever tab shows.
        pageDelay.setVisibility(dateTab ? View.INVISIBLE : View.VISIBLE);
        pageAt.setVisibility(dateTab ? View.VISIBLE : View.INVISIBLE);
        if (dateTab) hideKeyboard();
        refresh();
    }

    /** The current tab's choice, in minutes; -1 when there is none that fits. */
    private int chosen() {
        if (onDateTab) return SnoozeTimes.at(System.currentTimeMillis(), picked.getTimeInMillis());
        int index = unit.getSelectedItemPosition();
        if (index < 0 || index >= SnoozeTimes.UNITS.length) return -1;
        return SnoozeTimes.amount(amount.getText().toString(), SnoozeTimes.UNITS[index]);
    }

    /** Snooze is on only for a choice that fits; the Date and time tab says why not. */
    private void refresh() {
        if (dialog == null) return;
        timeValue.setText(DateFormat.getTimeFormat(this).format(picked.getTime()));
        long now = System.currentTimeMillis();
        long minutes = SnoozeTimes.minutesUntil(now, picked.getTimeInMillis());
        String limit = when(this, SnoozeTimes.until(now, SnoozeTimes.MAX_MINUTES));
        // The week's limit always shows, so a later day is never a surprise; in its place, why
        // Snooze is off.
        problem.setText(minutes < 1 ? getString(R.string.snooze_passed)
            : minutes > SnoozeTimes.MAX_MINUTES ? getString(R.string.snooze_too_far, limit)
            : getString(R.string.snooze_limit, limit));
        Button snooze = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
        if (snooze != null) snooze.setEnabled(chosen() > 0);
    }

    private void pickTime() {
        new TimePickerDialog(this, (view, hour, minute) -> {
            picked.set(Calendar.HOUR_OF_DAY, hour);
            picked.set(Calendar.MINUTE, minute);
            picked.set(Calendar.SECOND, 0);
            picked.set(Calendar.MILLISECOND, 0);
            refresh();
        }, picked.get(Calendar.HOUR_OF_DAY), picked.get(Calendar.MINUTE), DateFormat.is24HourFormat(this)).show();
    }

    private void snoozeChosen() {
        int minutes = chosen();
        if (minutes > 0) snooze(minutes);
        // The picked time passed while the dialog stood open: say so, and stay.
        else refresh();
    }

    private void snooze(int minutes) {
        if (done) return;
        done = true;
        hideKeyboard();
        Context app = getApplicationContext();
        // The moment of the tap, once: the toast, the reminder left on the phone and the server all
        // count from it, however long the network takes.
        long pressedAt = System.currentTimeMillis();
        String until = when(this, SnoozeTimes.until(pressedAt, minutes));
        new Thread(() -> {
            try {
                ReminderReceiver.press(app, Reminders.SNOOZE, reminder, minutes, pressedAt);
            } catch (Exception error) {
                Logger.warn("PeckList: snooze failed: " + error);
            }
        }, "pecklist-snooze").start();
        Toast.makeText(app, getString(R.string.snooze_done, until), Toast.LENGTH_SHORT).show();
        dialog.dismiss();
    }

    private void hideKeyboard() {
        InputMethodManager keyboard = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (keyboard != null) keyboard.hideSoftInputFromWindow(amount.getWindowToken(), 0);
    }

    /** A quick pick's time: the clock today, with the weekday on another day ("3 hours" late at night). */
    private String clock(long at) {
        if (DateUtils.isToday(at)) return DateFormat.getTimeFormat(this).format(new Date(at));
        return DateUtils.formatDateTime(this, at, DateUtils.FORMAT_SHOW_WEEKDAY | DateUtils.FORMAT_ABBREV_WEEKDAY
            | DateUtils.FORMAT_SHOW_TIME);
    }

    /** When a snooze comes back: the time today, the day and time on another day. */
    static String when(Context context, long at) {
        if (DateUtils.isToday(at)) return DateFormat.getTimeFormat(context).format(new Date(at));
        return DateUtils.formatDateTime(context, at, DateUtils.FORMAT_SHOW_WEEKDAY | DateUtils.FORMAT_SHOW_DATE
            | DateUtils.FORMAT_SHOW_TIME | DateUtils.FORMAT_ABBREV_ALL | DateUtils.FORMAT_NO_YEAR);
    }
}
