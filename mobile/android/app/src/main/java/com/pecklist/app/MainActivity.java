package com.pecklist.app;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;

/** The one screen: the web app in a WebView, on the chosen server or standalone (ADR-0017). */
public class MainActivity extends BridgeActivity {

    /** Asks the web app to use Back (web/src/app/native/back.ts): true, false, or null from an older build without it. */
    private static final String ASK_WEB_APP = "typeof window.pecklistBack === 'function' ? window.pecklistBack() === true : null";

    /** The launcher shortcut (res/xml/shortcuts.xml): back to the connect page, whatever the server runs. */
    static final String CHOOSE_SERVER = "com.pecklist.app.CHOOSE_SERVER";

    /** The app's own Change server, which goes without asking (Consent.toChangeServer). In-process only. */
    static Intent chooseServer(Context context) {
        return NotificationToken.stamp(context, new Intent(context, MainActivity.class).setAction(CHOOSE_SERVER));
    }

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
        ServerChoice.keepEarlierAgreements(this);
        Consent.Answer leaving = leaveServerIfAsked(getIntent());
        boolean choosing = leaving == Consent.Answer.GO;
        // A long-press shortcut's page, for the web app once it loads (ShellPlugin.load).
        Shortcuts.open(this, getIntent());
        registerPlugin(ShellPlugin.class);
        // A crash is kept for the next start, where the web app offers a report (PL-116).
        Usage.watchForCrashes(this);
        config = RuntimeConfig.load(this, ServerChoice.get(this));
        super.onCreate(savedInstanceState);
        if (bridge != null) {
            ShellWebViewClient client = new ShellWebViewClient(bridge);
            bridge.setWebViewClient(client);
            checkForGate(client);
            // No stretch when pulling past the top: it moved the bottom bar too. A pull syncs instead
            // (web/src/app/sync/PullToRefresh.tsx).
            bridge.getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
            // The WebView taking focus (showKeyboard, the window coming back) must not move the
            // page's focus to its first control: the Add task shortcut's field lost it to Filter (QA).
            bridge.getWebView().getSettings().setNeedInitialFocus(false);
        }
        keepClearOfSystemBars();
        // Every kind's channel from the start, so the phone's settings list them all (PL-115).
        Channels.ensure(this);
        // The plugins loaded in super.onCreate; one of them just made a channel nothing uses.
        Channels.dropPluginDefault(this);
        // Force-stopping the app clears its alarms; opening it again sets the check-in again, and
        // one stopped after a sign-out (or slowed by failures) starts afresh.
        BackgroundCheck.resume(this);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                back();
            }
        });
        if (choosing && bridge != null) bridge.getWebView().loadUrl(bridge.getLocalUrl() + "/connect");
        if (leaving == Consent.Answer.ASK) askToChangeServer();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        if (CHOOSE_SERVER.equals(intent.getAction())) {
            // Ask before anything goes: recreating first would lose what the page holds (a title
            // being typed, an open editor) even when the person then cancels.
            if (changeServer(intent) == Consent.Answer.ASK) {
                askToChangeServer();
                return;
            }
            setIntent(intent);
            recreate();
            return;
        }
        Shortcuts.open(this, intent);
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
            // Vouched for now by an authority installed on this phone that the person never
            // agreed to (audit A2): stop, and ask.
            if (InstalledCa.unagreed(this, server)) {
                runOnUiThread(() -> askAboutInstalledCa(server));
                return;
            }
            if (Gate.gated(this, server) && bridge != null) client.showGate(bridge.getWebView());
        }, "pecklist-gate").start();
    }

    /** Trust the installed authority for this server, or leave it for the connect page. */
    private void askAboutInstalledCa(String server) {
        if (isFinishing() || isDestroyed()) return;
        if (bridge != null) bridge.getWebView().loadUrl("about:blank");
        new AlertDialog.Builder(this)
            .setTitle(R.string.installed_ca_title)
            .setMessage(getString(R.string.installed_ca_body, server.replaceFirst("^https?://", "")))
            .setCancelable(false)
            .setPositiveButton(R.string.installed_ca_trust, (dialog, which) -> {
                ServerChoice.agreeInstalledCa(this, server);
                BackgroundCheck.resume(this);
                recreate();
            })
            .setNegativeButton(R.string.offline_other, (dialog, which) -> {
                setIntent(chooseServer(this));
                recreate();
            })
            .show();
    }

    /**
     * The "Change server" shortcut: off the server, onto the app's own connect page. It works even
     * when the server's web build is too old for the app or will not load. Data on the server stays.
     */
    private Consent.Answer leaveServerIfAsked(Intent intent) {
        if (intent == null || !CHOOSE_SERVER.equals(intent.getAction())) return null;
        Consent.Answer answer = changeServer(intent);
        setIntent(new Intent(this, MainActivity.class).setAction(Intent.ACTION_MAIN));
        // Back from Recents after the process died: the launcher's intent again, asked about once already.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0 && answer == Consent.Answer.ASK) return null;
        if (answer == Consent.Answer.GO && ServerChoice.get(this) != null) {
            ServerChoice.clear(this);
            BackgroundCheck.forgetServer(this);
            Shortcuts.clear(this);
            Widgets.clear(this);
        }
        return answer;
    }

    /** Any app can send Change server (the launcher does): off a server, it asks first (Security 2026-11-19). */
    private Consent.Answer changeServer(Intent intent) {
        return Consent.toChangeServer(ServerChoice.get(this) != null, NotificationToken.carried(this, intent));
    }

    /** Change server from outside the app: on yes, as the app's own; on no, the server as it was. */
    private void askToChangeServer() {
        String server = ServerChoice.get(this);
        if (server == null || isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
            .setTitle(R.string.confirm_change_title)
            .setMessage(getString(R.string.confirm_change_body, server.replaceFirst("^https?://", "")))
            .setPositiveButton(R.string.confirm_change_yes, (dialog, which) -> {
                setIntent(chooseServer(this));
                recreate();
            })
            .setNegativeButton(android.R.string.cancel, null)
            .show();
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
        new Thread(() -> {
            ReminderReceiver.retryPending(app);
            // Widget ticks a stopped process never sent (Widgets.tick).
            Widgets.sendDue(app);
            Widgets.redraw(app);
        }, "pecklist-pending").start();
    }

    @Override
    public void onPause() {
        showing = false;
        // Write the WebView's cookies to disk now: Android saves them on its own schedule, so the
        // session from a sign-in a few seconds ago was lost when the app was stopped or killed
        // before then, and the next start showed the sign-in page again.
        CookieManager.getInstance().flush();
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
            Logger.debug("PeckList", "Back: the web app answered " + used);
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
