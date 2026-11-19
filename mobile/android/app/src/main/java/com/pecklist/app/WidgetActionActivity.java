package com.pecklist.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/**
 * A Today widget row pressed (TodayWidget): open its task in the app, or tick it off. A widget's
 * list gives all its rows one intent, so both come here, unseen, and it closes at once.
 */
public class WidgetActionActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri data = getIntent() == null ? null : getIntent().getData();
        String what = data == null || !Widgets.SCHEME.equals(data.getScheme()) ? null : data.getHost();
        String id = data == null ? null : data.getLastPathSegment();
        if (WidgetTasks.safeId(id)) {
            if ("open".equals(what)) {
                startActivity(new Intent(Shortcuts.ACTION, Uri.parse(Shortcuts.SCHEME + ":/today?task=" + id), this, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } else if ("complete".equals(what)) {
                String title = getIntent().getStringExtra(Widgets.EXTRA_TITLE);
                Widgets.tick(getApplicationContext(), id, title == null ? "" : title);
            }
        }
        finish();
        overridePendingTransition(0, 0);
    }
}
