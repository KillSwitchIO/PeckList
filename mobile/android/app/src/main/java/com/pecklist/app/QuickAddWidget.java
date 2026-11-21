package com.pecklist.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

/** The 1x1 quick add widget (PL-121): a round + that opens Today with the add field ready. */
public class QuickAddWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        draw(context, manager, ids, R.layout.widget_quick_add);
    }

    static void draw(Context context, AppWidgetManager manager, int[] ids, int layout) {
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), layout);
            views.setOnClickPendingIntent(R.id.widget_quick_add, Widgets.page(context, "/today?add=1"));
            Widgets.say(context, views);
            manager.updateAppWidget(id, views);
        }
    }
}
