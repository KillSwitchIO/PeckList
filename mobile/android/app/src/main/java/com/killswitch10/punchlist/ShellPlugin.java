package com.killswitch10.punchlist;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * What the web app can ask of the Android shell (ADR-0017), as {@code PunchlistShell} in
 * {@code web/src/adapters/capacitor-shell.ts}. The web build a server ships may be newer or older
 * than this shell, so methods are only ever added, and {@code info().api} says which exist.
 */
@CapacitorPlugin(name = "PunchlistShell")
public class ShellPlugin extends Plugin {

    /** Bumped when a method is added; the web app checks it before calling a newer one. */
    private static final int API = 1;

    private final ExecutorService network = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();
        result.put("api", API);
        String server = ServerChoice.get(getContext());
        // JSONObject drops a null value; standalone must read as server: null, not a missing key.
        result.put("server", server == null ? JSONObject.NULL : server);
        result.put("version", versionName());
        call.resolve(result);
    }

    /**
     * Whether an address is a Punchlist server; resolves with the origin it answers on. An address
     * typed without a scheme is tried with https first, then plain http (a server on a home
     * network often has no certificate); the web app warns before using an http one.
     */
    @PluginMethod
    public void checkServer(PluginCall call) {
        String typed = call.getString("url", "");
        String origin = ServerChoice.normalize(typed);
        if (origin == null) {
            call.reject("not an address", "invalid");
            return;
        }
        boolean schemeTyped = typed.contains("://");
        network.execute(() -> {
            try {
                ServerCheck.Result result;
                try {
                    result = ServerCheck.check(origin);
                } catch (ServerCheck.Failure failure) {
                    if (schemeTyped || failure.code.equals("certificate")) throw failure;
                    try {
                        result = ServerCheck.check(ServerChoice.normalize("http://" + typed.trim()));
                    } catch (ServerCheck.Failure ignored) {
                        throw failure;
                    }
                }
                JSObject answer = new JSObject();
                answer.put("url", result.origin);
                answer.put("info", JSObject.fromJSONObject(result.info));
                call.resolve(answer);
            } catch (ServerCheck.Failure failure) {
                call.reject(failure.getMessage(), failure.code);
            } catch (Exception error) {
                call.reject(String.valueOf(error.getMessage()), "unreachable");
            }
        });
    }

    /** Use this server from now on: the app restarts on it. */
    @PluginMethod
    public void connect(PluginCall call) {
        String origin = ServerChoice.normalize(call.getString("url"));
        if (origin == null) {
            call.reject("not an address", "invalid");
            return;
        }
        ServerChoice.set(getContext(), origin);
        call.resolve();
        restart();
    }

    /** Back to the app on its own (standalone): the app restarts without a server. */
    @PluginMethod
    public void disconnect(PluginCall call) {
        ServerChoice.clear(getContext());
        call.resolve();
        restart();
    }

    /** A provider sign-in started in the WebView goes to a Custom Tab instead. */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String server = ServerChoice.get(getContext());
        String provider = NativeSignIn.providerOf(server, url);
        if (provider == null) return null;
        NativeSignIn.Start start = NativeSignIn.start(getContext(), server, url, provider);
        new CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(getActivity(), start.handoff);
        return true;
    }

    /** The provider sign-in coming back: trade the code for a session in the WebView. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        Uri data = intent.getData();
        if (!NativeSignIn.isReturn(getContext(), data)) return;
        NativeSignIn.Redeem redeem = NativeSignIn.finish(getContext(), ServerChoice.get(getContext()), data);
        if (redeem == null) {
            Logger.warn("Punchlist: a sign-in came back that this app did not start");
            return;
        }
        getBridge().getWebView().post(() -> getBridge().getWebView().postUrl(redeem.url, redeem.body));
    }

    @Override
    protected void handleOnDestroy() {
        network.shutdownNow();
    }

    private void restart() {
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    private String versionName() {
        try {
            PackageManager manager = getContext().getPackageManager();
            PackageInfo info = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? manager.getPackageInfo(getContext().getPackageName(), PackageManager.PackageInfoFlags.of(0))
                : manager.getPackageInfo(getContext().getPackageName(), 0);
            return info.versionName;
        } catch (PackageManager.NameNotFoundException error) {
            return "";
        }
    }
}
