package com.pecklist.app;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.util.ArrayList;
import java.util.List;

/** The Today widget's rows (TodayWidget): one per task its view shows (TodayWidget.rows). */
public class TodayWidgetService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Rows(getApplicationContext(),
            intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID));
    }

    static final class Rows implements RemoteViewsFactory {
        private final Context context;
        private final int widgetId;
        private String key = WidgetViews.TODAY;
        private String today = "";
        private List<WidgetTasks.Shown> rows = new ArrayList<>();

        Rows(Context context, int widgetId) {
            this.context = context;
            this.widgetId = widgetId;
        }

        @Override
        public void onCreate() {}

        @Override
        public void onDataSetChanged() {
            key = WidgetStore.choice(context, widgetId);
            today = Widgets.today();
            rows = TodayWidget.rows(WidgetStore.read(context), key, today);
        }

        @Override
        public void onDestroy() {
            rows = new ArrayList<>();
        }

        @Override
        public int getCount() {
            return rows.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_today_row);
            if (position >= rows.size()) return row;
            WidgetTasks.Shown shown = rows.get(position);
            WidgetTasks.Task task = shown.task;
            row.setTextViewText(R.id.row_title, task.title);
            String when = whenText(shown, task);
            // Colors stay in resources (a view each, a drawable each), so a switch to dark mode
            // redraws them right; a color set here would keep the mode it was drawn in.
            int shownWhen = shown.overdue ? R.id.row_late : R.id.row_when;
            row.setViewVisibility(R.id.row_when, when != null && !shown.overdue ? View.VISIBLE : View.GONE);
            row.setViewVisibility(R.id.row_late, when != null && shown.overdue ? View.VISIBLE : View.GONE);
            if (when != null) row.setTextViewText(shownWhen, when);
            row.setImageViewResource(R.id.row_check, Widgets.checkIcon(task.priority));
            Integer color = Widgets.listColor(task.color);
            row.setViewVisibility(R.id.row_dot, color == null ? View.GONE : View.VISIBLE);
            if (color != null) row.setInt(R.id.row_dot, "setColorFilter", color);
            row.setContentDescription(R.id.row_check, context.getString(R.string.widget_complete, task.title));
            row.setOnClickFillInIntent(R.id.row, new Intent().setData(Uri.parse(Widgets.SCHEME + "://open/" + task.id)));
            row.setOnClickFillInIntent(R.id.row_check, new Intent().setData(Uri.parse(Widgets.SCHEME + "://complete/" + task.id))
                .putExtra(Widgets.EXTRA_TITLE, task.title));
            return row;
        }

        /**
         * Today: the time, or an overdue task's date. Other views also show what is not today's:
         * the date (and time) ahead, "Today" for an untimed task of today's, nothing for no date.
         */
        private String whenText(WidgetTasks.Shown shown, WidgetTasks.Task task) {
            String time = task.time != null ? Widgets.timeText(context, task.time) : null;
            boolean dated = shown.day != null;
            if (shown.overdue || (dated && !WidgetViews.TODAY.equals(key) && shown.day.compareTo(today) > 0)) {
                return Widgets.dayText(context, shown.day) + (time != null ? ", " + time : "");
            }
            if (time != null) return time;
            if (dated && !WidgetViews.TODAY.equals(key) && shown.day.equals(today)) {
                return context.getString(R.string.widget_today_title);
            }
            return null;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return position < rows.size() ? rows.get(position).task.id.hashCode() : position;
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }
    }
}
