package com.pecklist.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** The 4x1 quick add widget (PL-121): a bar that looks like the add field, opening it, with a microphone to add by voice (PL-113). */
public class QuickAddBarWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_add_bar);
            views.setOnClickPendingIntent(R.id.widget_quick_add, Widgets.page(context, "/today?add=1"));
            Intent voice = new Intent(AddTextActivity.ACTION_VOICE, null, context, AddTextActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            views.setOnClickPendingIntent(R.id.widget_voice,
                PendingIntent.getActivity(context, 1, voice, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            manager.updateAppWidget(id, views);
        }
    }
}
