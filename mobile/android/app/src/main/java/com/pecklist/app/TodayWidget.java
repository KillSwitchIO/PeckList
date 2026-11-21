package com.pecklist.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

/**
 * The Today widget (PL-121): today's open tasks, overdue first, each ticked off right there with a
 * short Undo; a + opens the add bar. Rows come from TodayWidgetService.
 */
public class TodayWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        draw(context, manager, ids);
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        Widgets.scheduleMidnight(context);
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

    static void draw(Context context, AppWidgetManager manager, int[] ids) {
        boolean has = WidgetStore.has(context);
        int open = WidgetTasks.count(WidgetStore.tasks(context), WidgetStore.asOf(context), Widgets.today(),
            WidgetStore.hidden(context))[0];
        WidgetStore.Tick undo = WidgetStore.undoable(context, System.currentTimeMillis());
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
            Intent rows = new Intent(context, TodayWidgetService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
            rows.setData(Uri.parse(rows.toUri(Intent.URI_INTENT_SCHEME)));
            views.setRemoteAdapter(R.id.widget_list, rows);
            views.setEmptyView(R.id.widget_list, R.id.widget_empty);
            views.setTextViewText(R.id.widget_empty, context.getString(has ? R.string.widget_today_empty : R.string.widget_signed_out));
            views.setTextViewText(R.id.widget_title_text, context.getString(R.string.widget_today_title));
            views.setContentDescription(R.id.widget_add, context.getString(R.string.widget_add));
            views.setTextViewText(R.id.widget_undo, context.getString(R.string.widget_undo));
            views.setTextViewText(R.id.widget_count, String.valueOf(open));
            views.setViewVisibility(R.id.widget_count, open > 0 ? View.VISIBLE : View.GONE);
            views.setOnClickPendingIntent(R.id.widget_title, Widgets.page(context, "/today"));
            views.setOnClickPendingIntent(R.id.widget_empty, Widgets.page(context, "/today"));
            views.setOnClickPendingIntent(R.id.widget_add, Widgets.page(context, "/today?add=1"));
            // One template for every row: the row opens its task, the checkbox ticks it (WidgetActionActivity).
            views.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getActivity(context, 0,
                new Intent(context, WidgetActionActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
            views.setViewVisibility(R.id.widget_undo_bar, undo != null ? View.VISIBLE : View.GONE);
            if (undo != null) {
                views.setTextViewText(R.id.widget_undo_text, context.getString(R.string.widget_done, undo.title));
                Intent take = new Intent(context, WidgetUndoReceiver.class).setAction(Widgets.ACTION_UNDO)
                    .setData(Uri.parse(Widgets.SCHEME + "://undo/" + undo.id));
                views.setOnClickPendingIntent(R.id.widget_undo, PendingIntent.getBroadcast(context, 1, take,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            }
            manager.updateAppWidget(id, views);
        }
    }
}
