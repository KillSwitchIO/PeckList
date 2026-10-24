package com.killswitch10.punchlist;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/** The one screen: the web app in a WebView, on the chosen server or standalone (ADR-0017). */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShellPlugin.class);
        config = RuntimeConfig.load(this, ServerChoice.get(this));
        super.onCreate(savedInstanceState);
    }
}
