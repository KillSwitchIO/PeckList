package com.pecklist.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.text.format.DateFormat;
import java.text.FieldPosition;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.Objects;

/**
 * The clock the phone's own screens read times on (snooze, widgets): the app's, as the web app
 * works it out (Settings &gt; Dates: schema 22, shell api 17, web/src/app/native/nativeClock.ts).
 * Until the app has said, and while it says to (Automatic, which on a phone is the phone's own
 * setting), the phone's own 12/24-hour setting, read each time.
 */
final class Clock {
    private static final String PREFS = "pecklist.clock";
    private static final String TWENTY_FOUR = "twentyFour";

    private Clock() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The app's clock from now on, null for the phone's own. False when it already was: nothing to redraw. */
    static boolean set(Context context, Boolean twentyFour) {
        SharedPreferences prefs = prefs(context);
        Boolean stored = prefs.contains(TWENTY_FOUR) ? prefs.getBoolean(TWENTY_FOUR, false) : null;
        if (Objects.equals(stored, twentyFour)) return false;
        if (twentyFour == null) prefs.edit().remove(TWENTY_FOUR).apply();
        else prefs.edit().putBoolean(TWENTY_FOUR, twentyFour).apply();
        return true;
    }

    /** Whether times read on a 24-hour clock: the app's when it has said (`stored`), else the phone's. */
    static boolean decide(Boolean stored, boolean phone) {
        return stored != null ? stored : phone;
    }

    static boolean is24(Context context) {
        SharedPreferences prefs = prefs(context);
        Boolean stored = prefs.contains(TWENTY_FOUR) ? prefs.getBoolean(TWENTY_FOUR, false) : null;
        return decide(stored, DateFormat.is24HourFormat(context));
    }

    /** A time of day as these screens show it: "17:30" or "5:30 PM", in the app's language. */
    static String format(Context context, Date at) {
        return format(context, at, "");
    }

    /**
     * A time of day with the date parts a skeleton names ("EEE" for "Thu 17:30", "EEEMMMd" for
     * "Thu, Nov 26, 17:30"), ordered and joined as the app's language does.
     */
    static String format(Context context, Date at, String dateSkeleton) {
        Locale locale = locale(context);
        String pattern = DateFormat.getBestDateTimePattern(locale, dateSkeleton + (is24(context) ? "Hm" : "hm"));
        return formatDate(pattern, locale, at);
    }

    /** The phone's language, which these screens speak. */
    static Locale locale(Context context) {
        return context.getResources().getConfiguration().getLocales().get(0);
    }

    /**
     * A date in a pattern (SimpleDateFormat's), with French's "1er" for the first of a month beside
     * the month's name ("mar. 1er déc."), as the web app writes it (PL-148). Not in numbers
     * ("01/12"), and not a day with no month named beside it.
     */
    static String formatDate(String pattern, Locale locale, Date at) {
        SimpleDateFormat format = new SimpleDateFormat(pattern, locale);
        if (!"fr".equals(locale.getLanguage()) || !namesTheMonth(pattern)) return format.format(at);
        Calendar calendar = format.getCalendar();
        calendar.setTime(at);
        if (calendar.get(Calendar.DAY_OF_MONTH) != 1) return format.format(at);
        StringBuffer text = new StringBuffer();
        FieldPosition day = new FieldPosition(java.text.DateFormat.Field.DAY_OF_MONTH);
        format.format(at, text, day);
        if (day.getEndIndex() > day.getBeginIndex() && "1".equals(text.substring(day.getBeginIndex(), day.getEndIndex()))) {
            text.insert(day.getEndIndex(), "er");
        }
        return text.toString();
    }

    /** Whether a pattern writes the month as a word (MMM, MMMM, LLL...), quoted text aside. */
    static boolean namesTheMonth(String pattern) {
        String unquoted = pattern.replaceAll("'[^']*'", "");
        return unquoted.contains("MMM") || unquoted.contains("LLL");
    }
}
