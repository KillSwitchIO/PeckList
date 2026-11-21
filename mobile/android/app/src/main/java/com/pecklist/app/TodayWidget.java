package com.pecklist.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import java.util.Collections;
import java.util.List;

/**
 * The Today widget (PL-121): the open tasks of the view picked when it was placed (Today by
 * default; Upcoming, a list or a saved filter; WidgetConfigureActivity), each ticked off right
 * there with a short Undo; a + opens the add bar on that view's page. Rows come from
 * TodayWidgetService.
 */
public class TodayWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        draw(context, manager, ids);
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        Widgets.scheduleMidnight(context);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        WidgetStore.forget(context, ids);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (Widgets.ACTION_REDRAW.equals(action) || Intent.ACTION_TIME_CHANGED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action) || Intent.ACTION_DATE_CHANGED.equals(action)) {
            PendingResult pending = goAsync();
            Context app = context.getApplicationContext();
            new Thread(() -> {
                try {
                    // Ticks a dead process never sent go now.
                    Widgets.sendDue(app);
                    Widgets.redraw(app);
                } finally {
                    pending.finish();
                }
            }, "pecklist-widget-redraw").start();
        }
    }

    /** A widget's rows for its view: what TodayWidgetService lists and the header counts. */
    static List<WidgetTasks.Shown> rows(WidgetStore.Feed feed, String key, String today) {
        if (WidgetViews.TODAY.equals(key)) return WidgetTasks.today(feed.tasks, feed.asOf, today, feed.hidden);
        if (WidgetViews.UPCOMING.equals(key)) {
            return WidgetTasks.upcoming(feed.all, feed.upcoming, feed.asOf, today, feed.hidden);
        }
        WidgetViews.View view = WidgetViews.find(feed.views, key);
        if (view == null) return Collections.emptyList();
        return WidgetTasks.inView(feed.all, view.ids, feed.asOf, today, feed.hidden);
    }

    static void draw(Context context, AppWidgetManager manager, int[] ids) {
        // One reading of the hand-over for every widget drawn.
        WidgetStore.Feed feed = WidgetStore.read(context);
        String today = Widgets.today();
        boolean has = feed.has;
        List<WidgetViews.View> views = feed.views;
        WidgetStore.Tick undo = WidgetStore.undoable(context, System.currentTimeMillis());
        for (int id : ids) {
            String key = WidgetStore.choice(context, id);
            WidgetViews.View view = WidgetViews.find(views, key);
            // A list or filter the hand-over no longer has (deleted, or another account's).
            boolean gone = has && WidgetViews.isListOrFilter(key) && view == null;
            String page = gone ? "/today" : WidgetViews.page(key, view);
            int open = has && !gone ? rows(feed, key, today).size() : 0;

            RemoteViews remote = new RemoteViews(context.getPackageName(), R.layout.widget_today);
            Intent rows = new Intent(context, TodayWidgetService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
            rows.setData(Uri.parse(rows.toUri(Intent.URI_INTENT_SCHEME)));
            remote.setRemoteAdapter(R.id.widget_list, rows);
            remote.setEmptyView(R.id.widget_list, R.id.widget_empty);
            remote.setTextViewText(R.id.widget_empty, context.getString(emptyText(key, has, gone)));
            remote.setTextViewText(R.id.widget_title_text, title(context, key, view));
            remote.setContentDescription(R.id.widget_add, context.getString(R.string.widget_add));
            remote.setTextViewText(R.id.widget_undo, context.getString(R.string.widget_undo));
            remote.setTextViewText(R.id.widget_count, String.valueOf(open));
            remote.setViewVisibility(R.id.widget_count, open > 0 ? View.VISIBLE : View.GONE);
            remote.setOnClickPendingIntent(R.id.widget_title, Widgets.page(context, page));
            // Gone: a tap on the message picks another view, on any Android (Reconfigure is 12 and later).
            remote.setOnClickPendingIntent(R.id.widget_empty, gone ? configure(context, id) : Widgets.page(context, page));
            remote.setOnClickPendingIntent(R.id.widget_add, Widgets.page(context, page + "?add=1"));
            // One template for every row: the row opens its task, the checkbox ticks it (WidgetActionActivity).
            remote.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getActivity(context, 0,
                new Intent(context, WidgetActionActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
            // Undo shows on the widgets whose view held the task, not on every one (QA, PL-121).
            boolean offer = undo != null && has && !gone && WidgetViews.holds(key, view, feed.tasks, feed.upcoming, undo.id);
            remote.setViewVisibility(R.id.widget_undo_bar, offer ? View.VISIBLE : View.GONE);
            if (offer) {
                remote.setTextViewText(R.id.widget_undo_text, context.getString(R.string.widget_done, undo.title));
                Intent take = new Intent(context, WidgetUndoReceiver.class).setAction(Widgets.ACTION_UNDO)
                    .setData(Uri.parse(Widgets.SCHEME + "://undo/" + undo.id));
                remote.setOnClickPendingIntent(R.id.widget_undo, PendingIntent.getBroadcast(context, 1, take,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            }
            manager.updateAppWidget(id, remote);
        }
    }

    /** One widget drawn again, with its rows: after its view is picked. */
    static void redrawOne(Context context, int id) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        draw(context, manager, new int[] { id });
        manager.notifyAppWidgetViewDataChanged(new int[] { id }, R.id.widget_list);
        Widgets.scheduleMidnight(context);
    }

    /** The header: Today, Upcoming, the Inbox's own name, or the list's or filter's. */
    static String title(Context context, String key, WidgetViews.View view) {
        if (WidgetViews.UPCOMING.equals(key)) return context.getString(R.string.widget_upcoming_title);
        if (view == null) return context.getString(R.string.widget_today_title);
        if ("inbox".equals(view.kind)) return context.getString(R.string.widget_inbox_title);
        return view.name;
    }

    private static int emptyText(String key, boolean has, boolean gone) {
        if (!has) return WidgetViews.TODAY.equals(key) ? R.string.widget_signed_out : R.string.widget_signed_out_view;
        if (gone) return R.string.widget_view_gone;
        return WidgetViews.TODAY.equals(key) ? R.string.widget_today_empty : R.string.widget_view_empty;
    }

    private static PendingIntent configure(Context context, int id) {
        Intent intent = new Intent(context, WidgetConfigureActivity.class)
            .setAction(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            .setData(Uri.parse(Widgets.SCHEME + "://configure/" + id))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
