package com.killswitch10.punchlist;

import android.content.Context;
import android.Manifest;
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
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * What the web app can ask of the Android shell (ADR-0017), as {@code PunchlistShell} in
 * {@code web/src/adapters/capacitor-shell.ts}. The web build a server ships may be newer or older
 * than this shell, so methods are only ever added, and {@code info().api} says which exist.
 */
@CapacitorPlugin(
    name = "PunchlistShell",
    permissions = { @Permission(alias = ShellPlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class ShellPlugin extends Plugin {

    /** Bumped when a method is added; the web app checks it before calling a newer one. */
    private static final int API = 6;

    static final String NOTIFICATIONS = "notifications";

    private final ExecutorService network = Executors.newSingleThreadExecutor();

    /** A provider page an older server must show in the WebView itself: let it through once. */
    private volatile String passThrough;

    /**
     * Until when a provider runs in the WebView (an older server): its own pages, on other sites,
     * stay in the WebView too, or Android would open them in the browser, which would then be the
     * one signed in. Ends when the provider sends the WebView back to the server.
     */
    private static volatile long providerInWebViewUntil;

    /** Whether outside pages stay in the WebView just now (a provider or gate signing in there). */
    static boolean lettingThrough() {
        return System.currentTimeMillis() < providerInWebViewUntil;
    }

    private static final long PROVIDER_IN_WEBVIEW_MS = 10 * 60 * 1000;

    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();
        result.put("api", API);
        String server = ServerChoice.get(getContext());
        // JSONObject drops a null value; standalone must read as server: null, not a missing key.
        result.put("server", server == null ? JSONObject.NULL : server);
        result.put("version", versionName());
        result.put("choseStandalone", ServerChoice.choseStandalone(getContext()));
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
            // Where the answer came from: the https try, or the plain http one after it.
            String[] tried = { origin };
            try {
                ServerCheck.Result result;
                try {
                    result = checkWithCertificate(origin);
                } catch (ServerCheck.Failure failure) {
                    if (schemeTyped || failure.code.equals("certificate") || failure.code.equals("gated")) throw failure;
                    String plain = ServerChoice.normalize("http://" + typed.trim());
                    try {
                        result = ServerCheck.check(getContext(), plain);
                    } catch (ServerCheck.Failure second) {
                        // Plain http got further (a server, or a sign-in page in front of one): say that.
                        if (second.code.equals("unreachable")) throw failure;
                        tried[0] = plain;
                        throw second;
                    }
                }
                JSObject answer = new JSObject();
                answer.put("url", result.origin);
                answer.put("info", JSObject.fromJSONObject(result.info));
                call.resolve(answer);
            } catch (ServerCheck.Failure failure) {
                JSObject where = new JSObject();
                where.put("url", tried[0]);
                call.reject(failure.getMessage(), failure.code, where);
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
        // Another server: a certificate picked for the last one is not offered to it.
        if (!origin.equals(ServerChoice.get(getContext()))) ClientCert.forget(getContext());
        ServerChoice.set(getContext(), origin);
        BackgroundCheck.forgetServer(getContext());
        call.resolve();
        restart();
    }

    /** Back to the app on its own (standalone): the app restarts without a server. */
    @PluginMethod
    public void disconnect(PluginCall call) {
        ServerChoice.chooseStandalone(getContext());
        BackgroundCheck.forgetServer(getContext());
        ClientCert.forget(getContext());
        call.resolve();
        restart();
    }

    /**
     * Api 3: past a sign-in page in front of the server (Gate). In a browser tab, where passkeys
     * work, by default; {@code inApp} signs in to it in the WebView instead (a gate without passkeys,
     * or a server too old for the tab's way back).
     */
    @PluginMethod
    public void passGate(PluginCall call) {
        String server = ServerChoice.get(getContext());
        if (server == null) {
            call.reject("no server", "invalid");
            return;
        }
        String link = call.getString("link");
        if (link != null && !link.trim().isEmpty()) {
            // A share link (Pangolin): the gate answers its first load with its session cookie and
            // sends the WebView on to the server, which is then open to it like to a browser.
            String given = link.trim();
            String host = Uri.parse(given).getHost();
            if (host == null || !host.equalsIgnoreCase(Uri.parse(server).getHost())) {
                call.reject("the link is for another server", "invalid");
                return;
            }
            call.resolve();
            providerInWebViewUntil = System.currentTimeMillis() + PROVIDER_IN_WEBVIEW_MS;
            getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(given));
            return;
        }
        call.resolve();
        if (Boolean.TRUE.equals(call.getBoolean("inApp", false))) {
            providerInWebViewUntil = System.currentTimeMillis() + PROVIDER_IN_WEBVIEW_MS;
            getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(server + "/"));
            return;
        }
        network.execute(() -> {
            try {
                Uri tab = Gate.start(getContext(), server);
                getActivity().runOnUiThread(() -> openTab(tab));
            } catch (Exception error) {
                Logger.warn("Punchlist: could not start passing the gate: " + error);
            }
        });
    }

    /** Api 3: off the server and onto the app's own connect page (the offline page's "Use another server"). */
    @PluginMethod
    public void chooseServer(PluginCall call) {
        call.resolve();
        getActivity().runOnUiThread(() -> {
            getActivity().setIntent(new Intent(getContext(), MainActivity.class).setAction(MainActivity.CHOOSE_SERVER));
            getActivity().recreate();
        });
    }

    /**
     * Api 5: Android's notification settings for this app, where each channel (Reminders,
     * Assignments and dibs, Shares, Comments and mentions) has its own sound, vibration and on or
     * off. PL-115's "Manage on the phone".
     */
    @PluginMethod
    public void notificationSettings(PluginCall call) {
        Intent intent = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (android.content.ActivityNotFoundException missing) {
            // A phone without that screen: the app's own details page has the notification switch.
            getContext().startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    /** Where the tasks handed over on connecting wait (app-private storage). */
    private static final String CARRIED = "carried.json";

    /**
     * Api 6: the phone's own tasks ("this device only"), kept for the server it is connecting to.
     * Only that server's page gets them back ({@link #carried}), so a server chosen later cannot.
     */
    @PluginMethod
    public void carry(PluginCall call) {
        String data = call.getString("data");
        String server = call.getString("server");
        if (data == null || server == null) {
            call.reject("nothing to keep", "invalid");
            return;
        }
        try {
            JSONObject kept = new JSONObject();
            kept.put("server", server);
            kept.put("data", data);
            try (java.io.FileOutputStream out = getContext().openFileOutput(CARRIED, Context.MODE_PRIVATE)) {
                out.write(kept.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            call.resolve();
        } catch (JSONException | java.io.IOException failed) {
            call.reject("could not keep the tasks", "failed", failed);
        }
    }

    /** Api 6: the handed-over tasks, when the app is on the server they were kept for. */
    @PluginMethod
    public void carried(PluginCall call) {
        JSObject result = new JSObject();
        java.io.File file = new java.io.File(getContext().getFilesDir(), CARRIED);
        String server = ServerChoice.get(getContext());
        if (file.exists() && server != null) {
            try (java.io.FileInputStream in = new java.io.FileInputStream(file);
                 java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = in.read(buffer)) != -1) bytes.write(buffer, 0, read);
                JSONObject kept = new JSONObject(bytes.toString("UTF-8"));
                if (server.equalsIgnoreCase(kept.optString("server"))) result.put("data", kept.optString("data"));
            } catch (JSONException | java.io.IOException unreadable) {
                Logger.warn("Punchlist", "handed-over tasks unreadable: " + unreadable.getMessage());
            }
        }
        call.resolve(result);
    }

    /** Api 6: forget the handed-over tasks. */
    @PluginMethod
    public void clearCarried(PluginCall call) {
        new java.io.File(getContext().getFilesDir(), CARRIED).delete();
        call.resolve();
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
        if (System.currentTimeMillis() < providerInWebViewUntil && ("https".equals(url.getScheme()) || "http".equals(url.getScheme()))) {
            if (!ServerChoice.sameOrigin(server, address)) return false;
            providerInWebViewUntil = 0;
        }
        String provider = NativeSignIn.providerOf(server, url);
        if (provider != null) {
            network.execute(() -> {
                if (!appSignIn(getContext(), server)) {
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
                if (!appSignIn(getContext(), server)) {
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

    /**
     * The server check; when the TLS handshake fails other than on trust (a proxy wanting a client
     * certificate, R-FB-158), the person picks one from Android's store and it is tried once more.
     */
    private ServerCheck.Result checkWithCertificate(String origin) throws ServerCheck.Failure {
        try {
            return ServerCheck.check(getContext(), origin);
        } catch (ServerCheck.Failure failure) {
            if (!failure.tls || !origin.startsWith("https://") || getActivity() == null) throw failure;
            android.net.Uri address = android.net.Uri.parse(origin);
            int port = address.getPort() == -1 ? 443 : address.getPort();
            if (!ClientCert.pick(getActivity(), address.getHost(), port)) throw failure;
            return ServerCheck.check(getContext(), origin);
        }
    }

    /** Whether the server has the app's sign-in pages. Network: call off the main thread. */
    private static boolean appSignIn(Context context, String server) {
        try {
            return ServerCheck.check(context, server).info.optBoolean("appSignIn", false);
        } catch (Exception error) {
            Logger.warn("Punchlist: could not ask " + server + " about app sign-in: " + error.getMessage());
            return false;
        }
    }

    private void inWebView(String address) {
        passThrough = address;
        providerInWebViewUntil = System.currentTimeMillis() + PROVIDER_IN_WEBVIEW_MS;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(address));
    }

    private void openTab(Uri url) {
        new CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(getActivity(), url);
    }

    /** Api 3: whether the app may show notifications: granted, denied or prompt. */
    @PluginMethod
    public void notificationPermission(PluginCall call) {
        call.resolve(permission());
    }

    /** Api 3: Android's notification permission dialog (Android 13 and up), then the answer. */
    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(permission());
            return;
        }
        requestPermissionForAlias(NOTIFICATIONS, call, "notificationAnswered");
    }

    @PermissionCallback
    private void notificationAnswered(PluginCall call) {
        call.resolve(permission());
    }

    private JSObject permission() {
        JSObject answer = new JSObject();
        boolean enabled = androidx.core.app.NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        String state = enabled ? "granted"
            : Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState(NOTIFICATIONS) != PermissionState.DENIED ? "prompt"
            : "denied";
        answer.put("display", state);
        return answer;
    }

    /** Api 3: replace the reminders set ahead ({key, title, body, at, url, constant, repeats}); see Reminders. */
    @PluginMethod
    public void scheduleReminders(PluginCall call) {
        try {
            Reminders.handOver(getContext(), Reminders.parse(call.getArray("reminders", new com.getcapacitor.JSArray())));
            call.resolve();
        } catch (JSONException error) {
            call.reject("bad reminders: " + error.getMessage(), "invalid");
        }
    }

    /**
     * Api 3: show one notification now ({tag, title, body, url}). Api 4: with {news: true, actions},
     * it is news from the server (an assignment, a share, a comment) that arrived while the app was
     * on screen, shown as the background check-in shows it, with its own buttons; the same tag as
     * the check-in's replaces rather than repeats.
     */
    @PluginMethod
    public void showNotification(PluginCall call) {
        String tag = call.getString("tag", "");
        if (Boolean.TRUE.equals(call.getBoolean("news", false))) {
            try {
                Reminders.showNews(getContext(), tag, call.getString("category", ""), call.getString("title", "Punchlist"),
                    call.getString("body", ""), call.getString("url", "/today"), call.getArray("actions", new com.getcapacitor.JSArray()));
                call.resolve();
            } catch (JSONException error) {
                call.reject("bad news: " + error.getMessage(), "invalid");
            }
            return;
        }
        Reminders.show(getContext(), new Reminders.Reminder("now:" + tag, call.getString("title", ""), call.getString("body", ""),
            System.currentTimeMillis(), call.getString("url", "/"), false, true));
        call.resolve();
    }

    /** A notification tapped while the app was closed: its intent started the app. */
    @Override
    public void load() {
        super.load();
        if (getActivity() != null) opened(getActivity().getIntent());
    }

    /**
     * A notification tapped, or one of its buttons that finishes in the app: tell the web app where
     * to go and what to do (retained, so a web app still starting gets it too).
     */
    private boolean opened(Intent intent) {
        String url = intent == null ? null : intent.getStringExtra(Reminders.EXTRA_URL);
        if (url == null || !url.startsWith("/")) return false;
        Reminders.cancelShown(getContext(), intent.getIntExtra(Reminders.EXTRA_SHOWN, 0));
        JSObject event = new JSObject();
        event.put("url", url);
        String action = intent.getStringExtra(Reminders.EXTRA_ACTION);
        if (action != null) {
            event.put("action", action);
            event.put("taskId", intent.getStringExtra(Reminders.EXTRA_TASK));
            event.put("minutes", intent.getIntExtra(Reminders.EXTRA_MINUTES, Reminders.SNOOZE_MINUTES));
        }
        // Handled: the same intent must not act again when the activity is recreated.
        intent.removeExtra(Reminders.EXTRA_URL);
        notifyListeners("notificationOpen", event, true);
        return true;
    }

    /** A provider sign-in coming back: trade the code for a session in the WebView. A link: show how it went. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (opened(intent)) return;
        Uri data = intent.getData();
        if (Gate.isReturn(getContext(), data)) {
            String home = ServerChoice.get(getContext());
            network.execute(() -> {
                try {
                    Gate.finish(getContext(), data);
                } catch (Exception error) {
                    Logger.warn("Punchlist: the gate's pass did not open: " + error);
                }
                if (home != null) getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(home + "/"));
            });
            return;
        }
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
