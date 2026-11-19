package com.pecklist.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

/** The 1x1 count widget (PL-121): open tasks due today or overdue, red while any are overdue. */
public class CountWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        draw(context, manager, ids);
        Widgets.scheduleMidnight(context);
    }

    static void draw(Context context, AppWidgetManager manager, int[] ids) {
        boolean has = WidgetStore.has(context);
        int[] count = WidgetTasks.count(WidgetStore.tasks(context), WidgetStore.asOf(context), Widgets.today(),
            WidgetStore.hidden(context));
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_count);
            // Nothing handed over yet (signed out, or never opened): a dash, not a reassuring 0.
            boolean late = count[1] > 0;
            views.setViewVisibility(R.id.widget_count_number, late ? View.GONE : View.VISIBLE);
            views.setViewVisibility(R.id.widget_count_late, late ? View.VISIBLE : View.GONE);
            views.setTextViewText(late ? R.id.widget_count_late : R.id.widget_count_number, has ? String.valueOf(count[0]) : "–");
            views.setContentDescription(R.id.widget_count_root,
                has ? context.getResources().getQuantityString(R.plurals.widget_count_said, count[0], count[0])
                    : context.getString(R.string.widget_signed_out));
            views.setOnClickPendingIntent(R.id.widget_count_root, Widgets.page(context, "/today"));
            manager.updateAppWidget(id, views);
        }
    }
}
