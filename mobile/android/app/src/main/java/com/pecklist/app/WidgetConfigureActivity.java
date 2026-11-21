package com.pecklist.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import java.util.List;

/**
 * What a Today widget shows (PL-121): asked when it is placed, and again from the launcher's
 * Reconfigure (Android 12 and later) or a tap on a widget whose list is gone. Today, Upcoming, a
 * list or a saved filter, in a dialog over the home screen; a tap picks and closes. Back keeps
 * what it showed (Today for a new one). The app's language and the phone's light or dark mode.
 */
public class WidgetConfigureActivity extends AppCompatActivity {

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bundle extras = getIntent().getExtras();
        if (extras != null) widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        // Any app may start this screen (launchers must): only a Today widget of ours is changed.
        if (!isOurTodayWidget(widgetId)) {
            finish();
            return;
        }
        // Placed and left with Back: the widget stays, on Today.
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));

        View content = LayoutInflater.from(this).inflate(R.layout.widget_configure, null);
        LinearLayout list = content.findViewById(R.id.configure_choices);
        String chosen = WidgetStore.choice(this, widgetId);
        WidgetStore.Feed feed = WidgetStore.read(this);
        boolean handed = feed.handsOverViews;
        List<WidgetViews.View> choices = WidgetViews.choices(feed.views, handed,
            getString(R.string.widget_today_title), getString(R.string.widget_upcoming_title));
        boolean listsHeaded = false;
        boolean filtersHeaded = false;
        for (WidgetViews.View each : choices) {
            boolean filter = each.isFilter();
            boolean ownList = WidgetViews.isListOrFilter(each.key) && !filter;
            if (ownList && !listsHeaded) {
                list.addView(heading(list, R.string.widget_configure_lists));
                listsHeaded = true;
            }
            if (filter && !filtersHeaded) {
                list.addView(heading(list, R.string.widget_configure_filters));
                filtersHeaded = true;
            }
            list.addView(row(list, each, each.key.equals(chosen)));
        }
        if (!handed) {
            TextView note = (TextView) heading(list, R.string.widget_configure_open_app);
            ViewCompat.setAccessibilityHeading(note, false);
            list.addView(note);
        }

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle(R.string.widget_configure_title)
            .setView(content)
            .setOnCancelListener(cancelled -> finish())
            .create();
        dialog.setCanceledOnTouchOutside(true);
        dialog.setOnDismissListener(dismissed -> {
            if (!isFinishing()) finish();
        });
        dialog.show();
    }

    private View heading(ViewGroup parent, int text) {
        TextView heading = (TextView) LayoutInflater.from(this).inflate(R.layout.widget_configure_heading, parent, false);
        heading.setText(text);
        return heading;
    }

    private View row(ViewGroup parent, WidgetViews.View choice, boolean chosen) {
        View row = LayoutInflater.from(this).inflate(R.layout.widget_configure_row, parent, false);
        ImageView icon = row.findViewById(R.id.configure_icon);
        TextView name = row.findViewById(R.id.configure_name);
        ImageView check = row.findViewById(R.id.configure_check);
        Integer color = Widgets.listColor(choice.color);
        int muted = themeColor(android.R.attr.textColorSecondary);
        int accent = getColor(R.color.notification_accent);
        if (WidgetViews.TODAY.equals(choice.key)) {
            icon.setImageResource(R.drawable.ic_view_today);
        } else if (WidgetViews.UPCOMING.equals(choice.key)) {
            icon.setImageResource(R.drawable.ic_view_upcoming);
        } else if (choice.isFilter()) {
            icon.setImageResource(R.drawable.ic_view_filter);
        } else if ("inbox".equals(choice.kind)) {
            icon.setImageResource(R.drawable.ic_view_inbox);
        } else {
            icon.setImageResource(R.drawable.ic_widget_dot);
        }
        // A list wears its color; the rest the quiet text color.
        icon.setImageTintList(ColorStateList.valueOf(color != null && !choice.isFilter() ? color : muted));
        name.setText("inbox".equals(choice.kind) ? getString(R.string.widget_inbox_title) : choice.name);
        check.setImageTintList(ColorStateList.valueOf(accent));
        check.setVisibility(chosen ? View.VISIBLE : View.INVISIBLE);
        if (chosen) name.setTextColor(accent);
        row.setSelected(chosen);
        row.setContentDescription(chosen ? getString(R.string.widget_configure_chosen, name.getText()) : name.getText());
        row.setOnClickListener(tapped -> pick(choice.key));
        return row;
    }

    private void pick(String key) {
        WidgetStore.choose(this, widgetId, key);
        TodayWidget.redrawOne(getApplicationContext(), widgetId);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
    }

    private boolean isOurTodayWidget(int id) {
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return false;
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        AppWidgetProviderInfo info = manager == null ? null : manager.getAppWidgetInfo(id);
        return info != null && new ComponentName(this, TodayWidget.class).equals(info.provider);
    }

    private int themeColor(int attr) {
        TypedValue value = new TypedValue();
        getTheme().resolveAttribute(attr, value, true);
        return value.resourceId != 0 ? getColor(value.resourceId) : value.data;
    }
}
