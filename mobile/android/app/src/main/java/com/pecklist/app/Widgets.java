package com.pecklist.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.text.format.DateUtils;
import com.getcapacitor.Logger;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The home-screen widgets (PL-121): Today (TodayWidget), quick add (QuickAddWidget,
 * QuickAddBarWidget) and the count (CountWidget). They draw from WidgetStore, and redraw on a
 * hand-over from the web app, a tick, the check-in, midnight and a clock or time zone change.
 */
final class Widgets {

    static final String ACTION_REDRAW = "com.pecklist.app.WIDGET_REDRAW";
    static final String ACTION_UNDO = "com.pecklist.app.WIDGET_UNDO";
    static final String EXTRA_TITLE = "pecklist.widgetTitle";
    static final String SCHEME = "pecklist-widget";

    private Widgets() {}

    /** The phone's date now, "YYYY-MM-DD", as the widgets pick today's tasks. */
    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    /** Api 12: the web app's tasks for the widgets ({asOf, tasks}, or signedOut). */
    static void setTasks(Context context, JSONObject feed) throws JSONException {
        if (feed.optBoolean("signedOut")) {
            clear(context);
            return;
        }
        WidgetStore.save(context, feed);
        redraw(context);
    }

    /** Signed out, another server or standalone: the widgets go back to "open PeckList". */
    static void clear(Context context) {
        WidgetStore.clear(context);
        redraw(context);
    }

    /**
     * The quick-add button's spoken label, set here rather than in the layout: the launcher inflates a
     * widget's layout in the phone's language, so only text set from code follows the app's own
     * language (PL-148).
     */
    static void say(Context context, android.widget.RemoteViews views) {
        views.setContentDescription(R.id.widget_quick_add, context.getString(R.string.widget_add));
    }

    /** Every widget drawn again from the store. */
    static void redraw(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        int[] today = manager.getAppWidgetIds(new ComponentName(context, TodayWidget.class));
        if (today.length > 0) {
            TodayWidget.draw(context, manager, today);
            manager.notifyAppWidgetViewDataChanged(today, R.id.widget_list);
        }
        int[] count = manager.getAppWidgetIds(new ComponentName(context, CountWidget.class));
        if (count.length > 0) CountWidget.draw(context, manager, count);
        if (today.length > 0 || count.length > 0) scheduleMidnight(context);
    }

    /**
     * Ticked off on the Today widget: gone at once with Undo offered, and sent as Complete once
     * the undo time is over. A process that dies first sends it at the next start, check-in or redraw.
     */
    static void tick(Context context, String taskId, String title) {
        WidgetStore.tick(context, taskId, title, System.currentTimeMillis());
        redraw(context);
        new Thread(() -> {
            try {
                Thread.sleep(WidgetStore.UNDO_MS + 300);
            } catch (InterruptedException stopped) {
                Thread.currentThread().interrupt();
            }
            sendDue(context);
            redraw(context);
        }, "pecklist-widget-tick").start();
    }

    /**
     * Ticks past their undo time, sent as Complete on a reminder is (ReminderReceiver): on a server
     * now or, offline, at the next check-in (Pending); standalone, by the web app (Held). Network:
     * call off the main thread.
     */
    static void sendDue(Context context) {
        for (WidgetStore.Tick each : WidgetStore.takeDue(context, System.currentTimeMillis())) {
            try {
                ReminderReceiver.press(context, Reminders.COMPLETE, new Reminders.Reminder(each.id + "@0", each.title, "", 0,
                    "/today?task=" + each.id, false, false), 0, each.at);
            } catch (RuntimeException error) {
                Logger.warn("PeckList: completing from the widget failed: " + error);
            }
        }
    }

    /**
     * A Complete the server refused for good (an older server only lets a task's reminder people
     * complete from outside the app): if the widget ticked it, it shows again rather than hiding a
     * task that is still open.
     */
    static void refused(Context context, String taskId) {
        if (WidgetStore.undone(context, taskId)) redraw(context);
    }

    /** Opens a page of the app (Shortcuts' allowlist), as the long-press shortcuts do. */
    static PendingIntent page(Context context, String page) {
        Intent intent = new Intent(Shortcuts.ACTION, Uri.parse(Shortcuts.SCHEME + ":" + page), context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, page.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** A redraw just after midnight, so "today" moves on with no one opening the app. */
    static void scheduleMidnight(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        Calendar next = Calendar.getInstance();
        next.add(Calendar.DAY_OF_YEAR, 1);
        next.set(Calendar.HOUR_OF_DAY, 0);
        next.set(Calendar.MINUTE, 1);
        next.set(Calendar.SECOND, 0);
        Intent intent = new Intent(context, TodayWidget.class).setAction(ACTION_REDRAW);
        PendingIntent redraw = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        alarms.set(AlarmManager.RTC, next.getTimeInMillis(), redraw);
    }

    /** A checkbox in the task's priority color, as in the app (web/src/core/palette.ts). */
    static int checkIcon(int priority) {
        switch (priority) {
            case 3: return R.drawable.ic_widget_check_high;
            case 2: return R.drawable.ic_widget_check_medium;
            case 1: return R.drawable.ic_widget_check_low;
            default: return R.drawable.ic_widget_check_none;
        }
    }

    /** A list's color, or null when it is not one. */
    static Integer listColor(String color) {
        if (color == null || !color.matches("#[0-9A-Fa-f]{6}")) return null;
        return Color.parseColor(color);
    }

    /** "17:30" on the app's clock (12 or 24 hours, Clock). */
    static String timeText(Context context, String time) {
        try {
            Date at = new SimpleDateFormat("HH:mm", Locale.US).parse(time);
            return at == null ? time : Clock.format(context, at);
        } catch (ParseException error) {
            return time;
        }
    }

    /** "2026-11-18" as a short date ("Nov 18"). */
    static String dayText(Context context, String day) {
        try {
            Date at = new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(day);
            return at == null ? day : DateUtils.formatDateTime(context, at.getTime(),
                DateUtils.FORMAT_SHOW_DATE | DateUtils.FORMAT_ABBREV_MONTH | DateUtils.FORMAT_NO_YEAR);
        } catch (ParseException error) {
            return day;
        }
    }
}
