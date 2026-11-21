package com.pecklist.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * What a Today widget can show (PL-121): Today (the default), Upcoming, a list or a saved filter,
 * picked when it is placed (WidgetConfigureActivity) and kept per widget (WidgetStore). The lists
 * and filters come from the web app's hand-over. Plain Java, so the rules test without a phone.
 */
final class WidgetViews {

    static final String TODAY = "today";
    static final String UPCOMING = "upcoming";
    private static final String LIST = "list:";
    private static final String FILTER = "filter:";

    private WidgetViews() {}

    /** A list or saved filter as the web app hands it over (web/src/core/widgetTasks.ts, WidgetView). */
    static final class View {
        final String key;
        /** "inbox", "list" or "filter". */
        final String kind;
        final String name;
        final String color;
        final List<String> ids;

        View(String key, String kind, String name, String color, List<String> ids) {
            this.key = key;
            this.kind = kind;
            this.name = name;
            this.color = color;
            this.ids = Collections.unmodifiableList(new ArrayList<>(ids));
        }

        boolean isFilter() {
            return key.startsWith(FILTER);
        }
    }

    /** Whether a key names something a widget can show; an id must be safe for a page address. */
    static boolean valid(String key) {
        if (TODAY.equals(key) || UPCOMING.equals(key)) return true;
        if (key == null) return false;
        if (key.startsWith(LIST)) return WidgetTasks.safeId(key.substring(LIST.length()));
        if (key.startsWith(FILTER)) return WidgetTasks.safeId(key.substring(FILTER.length()));
        return false;
    }

    /** Whether a key is a list or a saved filter (whose tasks the hand-over names). */
    static boolean isListOrFilter(String key) {
        return key != null && (key.startsWith(LIST) || key.startsWith(FILTER));
    }

    /** The view a key names among the handed-over ones, or null (gone, or not handed over yet). */
    static View find(List<View> views, String key) {
        for (View each : views) {
            if (each.key.equals(key)) return each;
        }
        return null;
    }

    /**
     * Whether a widget's view has the task: one of Today's tasks, Upcoming's, or the list's or
     * filter's. A tick's Undo shows only on the widgets that held it (QA, PL-121).
     */
    static boolean holds(String key, View view, List<WidgetTasks.Task> today, List<String> upcoming, String taskId) {
        if (TODAY.equals(key)) {
            for (WidgetTasks.Task each : today) if (each.id.equals(taskId)) return true;
            return false;
        }
        if (UPCOMING.equals(key)) return upcoming.contains(taskId);
        return view != null && view.ids.contains(taskId);
    }

    /**
     * The page a widget's title opens (its + adds "?add=1"): Shortcuts' allowlist takes each. The
     * Inbox has a page of its own; an unknown key opens Today.
     */
    static String page(String key, View view) {
        if (UPCOMING.equals(key)) return "/upcoming";
        if (view != null && "inbox".equals(view.kind)) return "/inbox";
        if (valid(key) && key.startsWith(LIST)) return "/lists/" + key.substring(LIST.length());
        if (valid(key) && key.startsWith(FILTER)) return "/filters/" + key.substring(FILTER.length());
        return "/today";
    }

    /**
     * What the configuration screen offers, in order: Today, Upcoming, then the lists (the Inbox
     * first, as the web app orders them) and the saved filters. Without a hand-over that names them
     * (never opened, or an older web app), only Today: Upcoming needs the newer hand-over too.
     */
    static List<View> choices(List<View> views, boolean handedViews, String todayName, String upcomingName) {
        List<View> choices = new ArrayList<>();
        choices.add(new View(TODAY, TODAY, todayName, "", Collections.emptyList()));
        if (!handedViews) return choices;
        choices.add(new View(UPCOMING, UPCOMING, upcomingName, "", Collections.emptyList()));
        for (View each : views) {
            if (!each.isFilter() && valid(each.key)) choices.add(each);
        }
        for (View each : views) {
            if (each.isFilter() && valid(each.key)) choices.add(each);
        }
        return choices;
    }
}
