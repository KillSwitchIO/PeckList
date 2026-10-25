package com.killswitch10.punchlist;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;

/** The one screen: the web app in a WebView, on the chosen server or standalone (ADR-0017). */
public class MainActivity extends BridgeActivity {

    /** Asks the web app to use Back (web/src/app/native/back.ts): true, false, or null from an older build without it. */
    private static final String ASK_WEB_APP = "typeof window.punchlistBack === 'function' ? window.punchlistBack() === true : null";

    private static volatile boolean showing;

    /** Whether the app is on screen, where the web app itself shows what is new (BackgroundCheck). */
    static boolean showing() {
        return showing;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShellPlugin.class);
        config = RuntimeConfig.load(this, ServerChoice.get(this));
        super.onCreate(savedInstanceState);
        if (bridge != null) bridge.setWebViewClient(new ShellWebViewClient(bridge));
        // Force-stopping the app clears its alarms; opening it again sets the check-in again.
        BackgroundCheck.schedule(this);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                back();
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        showing = true;
    }

    @Override
    public void onPause() {
        showing = false;
        super.onPause();
    }

    /**
     * Back closes the app's topmost popup or steps back in it. With nothing left to go back to the
     * app moves to the background, as Android apps do; a web build too old to answer gets the
     * WebView's own history instead.
     */
    private void back() {
        WebView webView = bridge == null ? null : bridge.getWebView();
        if (webView == null) {
            moveTaskToBack(true);
            return;
        }
        webView.evaluateJavascript(ASK_WEB_APP, (used) -> {
            Logger.debug("Punchlist", "Back: the web app answered " + used);
            if ("true".equals(used)) return;
            if ("null".equals(used) && webView.canGoBack()) webView.goBack();
            else moveTaskToBack(true);
        });
    }
}
