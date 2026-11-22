package com.pecklist.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.text.format.DateFormat;
import java.text.SimpleDateFormat;
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
        Locale locale = context.getResources().getConfiguration().getLocales().get(0);
        String pattern = DateFormat.getBestDateTimePattern(locale, dateSkeleton + (is24(context) ? "Hm" : "hm"));
        return new SimpleDateFormat(pattern, locale).format(at);
    }
}
