package com.killswitch10.punchlist;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
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
    private static final int API = 2;

    private final ExecutorService network = Executors.newSingleThreadExecutor();

    /** A provider page an older server must show in the WebView itself: let it through once. */
    private volatile String passThrough;

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
        BackgroundCheck.forgetServer(getContext());
        call.resolve();
        restart();
    }

    /** Back to the app on its own (standalone): the app restarts without a server. */
    @PluginMethod
    public void disconnect(PluginCall call) {
        ServerChoice.clear(getContext());
        BackgroundCheck.forgetServer(getContext());
        call.resolve();
        restart();
    }

    /** Api 2: the background check-in (BackgroundCheck): on or off, how often, and whether Android lets it run. */
    @PluginMethod
    public void backgroundCheck(PluginCall call) {
        call.resolve(BackgroundCheck.state(getContext()));
    }

    /** Api 2: turn the check-in on or off ({@code enabled}), or check every {@code minutes}. */
    @PluginMethod
    public void setBackgroundCheck(PluginCall call) {
        BackgroundCheck.change(getContext(), call.getBoolean("enabled"), call.getInt("minutes"));
        call.resolve(BackgroundCheck.state(getContext()));
    }

    /** Api 2: Android's dialog to let Punchlist run in the background; resolves once it closes. */
    @PluginMethod
    public void allowBackground(PluginCall call) {
        BackgroundCheck.markAsked(getContext());
        if (BackgroundCheck.unrestricted(getContext())) {
            call.resolve(BackgroundCheck.state(getContext()));
            return;
        }
        try {
            startActivityForResult(call, BackgroundCheck.askToRunInBackground(getContext()), "backgroundAnswered");
        } catch (ActivityNotFoundException error) {
            // Some phones have no such dialog: their battery settings are the only way.
            call.resolve(BackgroundCheck.state(getContext()));
        }
    }

    @ActivityCallback
    private void backgroundAnswered(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve(BackgroundCheck.state(getContext()));
    }

    /**
     * A provider sign-in or link started in the WebView goes to a Custom Tab instead, when the
     * server has the pages for it ({@code appSignIn} in its info). An older server does not: the
     * provider then runs in the WebView, as before the app had tabs.
     */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String address = url.toString();
        if (address.equals(passThrough)) {
            passThrough = null;
            return null;
        }
        String server = ServerChoice.get(getContext());
        String provider = NativeSignIn.providerOf(server, url);
        if (provider != null) {
            network.execute(() -> {
                if (!appSignIn(server)) {
                    inWebView(address);
                    return;
                }
                NativeSignIn.Start start = NativeSignIn.start(getContext(), server, url, provider);
                getActivity().runOnUiThread(() -> openTab(start.handoff));
            });
            return true;
        }
        String linking = NativeLink.providerOf(server, url);
        if (linking != null) {
            network.execute(() -> {
                if (!appSignIn(server)) {
                    inWebView(address);
                    return;
                }
                try {
                    Uri tab = NativeLink.start(getContext(), server, linking);
                    getActivity().runOnUiThread(() -> openTab(tab));
                } catch (Exception error) {
                    Logger.warn("Punchlist: could not start linking " + linking + ": " + error.getMessage());
                    String failed = server + "/settings?link=failed";
                    getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(failed));
                }
            });
            return true;
        }
        return null;
    }

    /** Whether the server has the app's sign-in pages. Network: call off the main thread. */
    private static boolean appSignIn(String server) {
        try {
            return ServerCheck.check(server).info.optBoolean("appSignIn", false);
        } catch (Exception error) {
            Logger.warn("Punchlist: could not ask " + server + " about app sign-in: " + error.getMessage());
            return false;
        }
    }

    private void inWebView(String address) {
        passThrough = address;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(address));
    }

    private void openTab(Uri url) {
        new CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(getActivity(), url);
    }

    /** A provider sign-in coming back: trade the code for a session in the WebView. A link: show how it went. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        Uri data = intent.getData();
        String server = ServerChoice.get(getContext());
        if (server != null && NativeLink.isReturn(getContext(), data)) {
            String settings = NativeLink.settingsUrl(server, data);
            getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(settings));
            return;
        }
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
