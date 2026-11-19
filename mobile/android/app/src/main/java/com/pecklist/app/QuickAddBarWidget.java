package com.pecklist.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** The 4x1 quick add widget (PL-121): a bar that looks like the add field, opening it. */
public class QuickAddBarWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        QuickAddWidget.draw(context, manager, ids, R.layout.widget_quick_add_bar);
    }
}
