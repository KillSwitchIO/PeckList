package com.killswitch10.punchlist;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;

/** The one screen: the web app in a WebView, on the chosen server or standalone (ADR-0017). */
public class MainActivity extends BridgeActivity {

    /** Asks the web app to use Back (web/src/app/native/back.ts): true, false, or null from an older build without it. */
    private static final String ASK_WEB_APP = "typeof window.punchlistBack === 'function' ? window.punchlistBack() === true : null";

    /** The launcher shortcut (res/xml/shortcuts.xml): back to the connect page, whatever the server runs. */
    static final String CHOOSE_SERVER = "com.killswitch10.punchlist.CHOOSE_SERVER";

    /** A second Back within this long leaves the app. */
    private static final long BACK_AGAIN_MS = 2000;

    private static volatile boolean showing;

    private long backPressedAt;

    /** Whether the app is on screen, where the web app itself shows what is new (BackgroundCheck). */
    static boolean showing() {
        return showing;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        boolean choosing = leaveServerIfAsked(getIntent());
        registerPlugin(ShellPlugin.class);
        config = RuntimeConfig.load(this, ServerChoice.get(this));
        super.onCreate(savedInstanceState);
        if (bridge != null) {
            ShellWebViewClient client = new ShellWebViewClient(bridge);
            bridge.setWebViewClient(client);
            checkForGate(client);
            // No stretch when pulling past the top: it moved the bottom bar too. A pull syncs instead
            // (web/src/app/sync/PullToRefresh.tsx).
            bridge.getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
        }
        keepClearOfSystemBars();
        // Force-stopping the app clears its alarms; opening it again sets the check-in again.
        BackgroundCheck.schedule(this);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                back();
            }
        });
        if (choosing && bridge != null) bridge.getWebView().loadUrl(bridge.getLocalUrl() + "/connect");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        if (CHOOSE_SERVER.equals(intent.getAction())) {
            setIntent(intent);
            recreate();
            return;
        }
        super.onNewIntent(intent);
    }

    /**
     * A sign-in page in front of the server may not show as a redirect when the app comes from its
     * cache: ask the server directly, and offer to pass it (Gate).
     */
    private void checkForGate(ShellWebViewClient client) {
        String server = ServerChoice.get(this);
        if (server == null) return;
        new Thread(() -> {
            if (Gate.gated(server) && bridge != null) client.showGate(bridge.getWebView());
        }, "punchlist-gate").start();
    }

    /**
     * The "Change server" shortcut: off the server, onto the app's own connect page. It works even
     * when the server's web build is too old for the app or will not load. Data on the server stays.
     */
    private boolean leaveServerIfAsked(Intent intent) {
        if (intent == null || !CHOOSE_SERVER.equals(intent.getAction())) return false;
        setIntent(new Intent(this, MainActivity.class).setAction(Intent.ACTION_MAIN));
        if (ServerChoice.get(this) != null) {
            ServerChoice.clear(this);
            BackgroundCheck.forgetServer(this);
        }
        return true;
    }

    /**
     * Android 15 draws apps under the status and navigation bars. Capacitor would leave that to the
     * page's CSS on newer WebViews, which a server's older web build does not do; so the WebView is
     * kept clear of the bars here, whatever build it runs, with the app's background behind them.
     */
    private void keepClearOfSystemBars() {
        View root = getWindow().getDecorView();
        root.setBackgroundColor(ContextCompat.getColor(this, R.color.system_bars));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            int kinds = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
            Insets bars = insets.getInsets(kinds);
            Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            // Used up here, so the page's env(safe-area-inset-*) is 0 and nothing pads twice.
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(kinds, Insets.NONE)
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
                .build();
        });
        root.requestApplyInsets();
    }

    @Override
    public void onResume() {
        super.onResume();
        showing = true;
        Context app = getApplicationContext();
        new Thread(() -> ReminderReceiver.retryPending(app), "punchlist-pending").start();
    }

    @Override
    public void onPause() {
        showing = false;
        super.onPause();
    }

    /**
     * Back closes the app's topmost popup or steps back in it (a web build too old to answer gets
     * the WebView's own history). With nothing left to go back to, a second Back leaves the app, so
     * one press too many never does.
     */
    private void back() {
        WebView webView = bridge == null ? null : bridge.getWebView();
        if (webView == null) {
            leaveOnSecondPress();
            return;
        }
        webView.evaluateJavascript(ASK_WEB_APP, (used) -> {
            Logger.debug("Punchlist", "Back: the web app answered " + used);
            if ("true".equals(used)) return;
            if ("null".equals(used) && webView.canGoBack()) webView.goBack();
            else leaveOnSecondPress();
        });
    }

    private void leaveOnSecondPress() {
        long now = SystemClock.elapsedRealtime();
        if (now - backPressedAt < BACK_AGAIN_MS) {
            backPressedAt = 0;
            moveTaskToBack(true);
            return;
        }
        backPressedAt = now;
        Toast.makeText(this, R.string.back_again, Toast.LENGTH_SHORT).show();
    }
}
