package com.pecklist.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.os.Build;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.os.LocaleListCompat;
import java.util.Locale;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * The language the app's own text speaks (PL-148): notification actions and channels, widgets,
 * dialogs. The web app hands over the person's choice in Settings (ShellPlugin.setLanguage, api 15)
 * so the phone's text matches the page's; null is automatic, the phone's own languages.
 *
 * <p>Android 13 and later keep a language per app, so the whole process (receivers, widgets,
 * services) follows it, and Settings > Apps > PeckList > Language shows it. Below 13 there is no
 * such thing: AppCompat switches the screen, and the app's own resources are switched here, again
 * at every start and after every configuration change (PeckListApp).
 */
final class Languages {

    private static final String PREFS = "pecklist.language";
    private static final String TAG = "tag";

    /** The same shape the workspace schema allows for settings.language. */
    private static final Pattern BCP47 = Pattern.compile("^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$");

    /** The languages the channels and widgets were last drawn in, so they are redrawn only on a change. */
    private static volatile String drawnIn;

    private Languages() {}

    /** The tag the web app sent, or null for automatic. Anything malformed is automatic too. */
    static String tagOf(String raw) {
        if (raw == null) return null;
        String tag = raw.trim();
        return tag.length() <= 35 && BCP47.matcher(tag).matches() ? tag : null;
    }

    /**
     * Whether a choice changes anything. Automatic again is no change, so a language picked in the
     * phone's own settings stays until the person picks one in the app.
     */
    static boolean changes(String stored, String wanted) {
        return !Objects.equals(stored, wanted);
    }

    /** The choice last handed over; null: automatic. */
    static String stored(Context context) {
        return prefs(context).getString(TAG, null);
    }

    /**
     * Speak `tag` from now on (null: automatic). Runs on the main thread. False when it already
     * did: nothing switched or redrawn.
     */
    static boolean change(Context context, String tag) {
        if (!changes(stored(context), tag)) return false;
        SharedPreferences.Editor edit = prefs(context).edit();
        if (tag == null) edit.remove(TAG);
        else edit.putString(TAG, tag);
        edit.apply();
        AppCompatDelegate.setApplicationLocales(listOf(tag));
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            switchResources(context.getApplicationContext(), tag);
            redrawIfChanged(context.getApplicationContext());
        }
        // From 13 the system hands the process a configuration change: PeckListApp redraws then.
        return true;
    }

    /** At start and after a configuration change below Android 13: the stored choice again. */
    static void restore(Context app) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return;
        String tag = stored(app);
        if (tag == null) return;
        AppCompatDelegate.setApplicationLocales(listOf(tag));
        switchResources(app, tag);
    }

    /** The first languages the app is drawn in, so the first change is noticed. */
    static void noteDrawn(Context app) {
        drawnIn = languagesOf(app);
    }

    /**
     * Channel names and widgets in the app's languages, when they changed since they were drawn:
     * a choice in the app, or the phone's language changed in its settings.
     */
    static void redrawIfChanged(Context app) {
        String now = languagesOf(app);
        if (now.equals(drawnIn)) return;
        drawnIn = now;
        Channels.renamed(app);
        Widgets.redraw(app);
    }

    /**
     * The app's languages as an Accept-Language header, for requests whose answer carries text
     * (the background check-in's reminders): the language picked in the app, else the phone's.
     */
    static String acceptLanguage(Context context) {
        return headerOf(languagesOf(context));
    }

    /** "de-AT,en-US" as "de-AT,en-US;q=0.9": most wanted first, at most five. Empty: English. */
    static String headerOf(String tags) {
        StringBuilder header = new StringBuilder();
        int n = 0;
        for (String tag : tags == null ? new String[0] : tags.split(",")) {
            String each = tag.trim();
            if (each.isEmpty() || each.equals("und")) continue;
            if (n > 0) header.append(',');
            header.append(each);
            if (n > 0) header.append(";q=0.").append(10 - n);
            if (++n == 5) break;
        }
        return n == 0 ? "en" : header.toString();
    }

    private static LocaleListCompat listOf(String tag) {
        return tag == null ? LocaleListCompat.getEmptyLocaleList() : LocaleListCompat.forLanguageTags(tag);
    }

    private static String languagesOf(Context context) {
        return context.getResources().getConfiguration().getLocales().toLanguageTags();
    }

    /** Below 13: the app's own resources (receivers and widgets use them) and Java's default locale. */
    @SuppressWarnings("deprecation")
    private static void switchResources(Context app, String tag) {
        Locale locale = tag == null
            ? Resources.getSystem().getConfiguration().getLocales().get(0)
            : Locale.forLanguageTag(tag);
        Locale.setDefault(locale);
        Resources resources = app.getResources();
        Configuration config = new Configuration(resources.getConfiguration());
        config.setLocale(locale);
        resources.updateConfiguration(config, resources.getDisplayMetrics());
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
