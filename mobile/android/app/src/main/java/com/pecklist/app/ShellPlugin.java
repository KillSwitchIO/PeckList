package com.pecklist.app;

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
 * What the web app can ask of the Android shell (ADR-0017), as {@code PeckListShell} in
 * {@code web/src/adapters/capacitor-shell.ts}. The web build a server ships may be newer or older
 * than this shell, so methods are only ever added, and {@code info().api} says which exist.
 */
@CapacitorPlugin(
    name = "PeckListShell",
    permissions = { @Permission(alias = ShellPlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class ShellPlugin extends Plugin {

    /** Bumped when a method is added; the web app checks it before calling a newer one. */
    private static final int API = 11;

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

    /** The shell's counts since the last ask, and the permission states (PL-116). */
    @PluginMethod
    public void usage(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("counts", Usage.countsOnly(Usage.takeCounts(getContext())));
            result.put("permissions", Usage.permissions(getContext()));
            call.resolve(result);
        } catch (org.json.JSONException error) {
            call.reject(error.getMessage());
        }
    }

    /** The crash since the last start, if any (kind and stack), used up by asking (PL-116). */
    @PluginMethod
    public void lastCrash(PluginCall call) {
        org.json.JSONObject crash = Usage.takeCrash(getContext());
        JSObject result = new JSObject();
        try {
            result.put("crash", crash == null ? JSONObject.NULL : JSObject.fromJSONObject(crash));
        } catch (org.json.JSONException error) {
            result.put("crash", JSONObject.NULL);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();
        result.put("api", API);
        String server = ServerChoice.get(getContext());
        // JSONObject drops a null value; standalone must read as server: null, not a missing key.
        result.put("server", server == null ? JSONObject.NULL : server);
        result.put("version", versionName());
        result.put("choseStandalone", ServerChoice.choseStandalone(getContext()));
        // Api 9: which build (Distribution), so the web app follows Google Play's rules in the Play one. Api 9
        // also passes fresh=1 on from a provider's sign-in to the hand-off (NativeSignIn).
        result.put("distribution", Distribution.NAME);
        call.resolve(result);
    }

    /**
     * Whether an address is a PeckList server; resolves with the origin it answers on. An address
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
                    if (schemeTyped || failure.code.equals("certificate") || failure.code.equals("gated")
                        || failure.code.equals("installed-ca")) throw failure;
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
                where.put("url", failure.origin != null ? failure.origin : tried[0]);
                call.reject(failure.getMessage(), failure.code, where);
            } catch (Exception error) {
                call.reject(String.valueOf(error.getMessage()), "unreachable");
            }
        });
    }

    /**
     * Use this server from now on: the app restarts on it. {@code plainHttp} and {@code installedCa}
     * say what the person agreed to on the connect page (api 8, audit A2). A server's page gets the
     * app's own dialog first (audit A4); a no rejects with "cancelled".
     */
    @PluginMethod
    public void connect(PluginCall call) {
        String origin = ServerChoice.normalize(call.getString("url"));
        if (origin == null) {
            call.reject("not an address", "invalid");
            return;
        }
        boolean plain = origin.startsWith("http://");
        boolean installedCa = Boolean.TRUE.equals(call.getBoolean("installedCa", false));
        boolean plainAgreed = Boolean.TRUE.equals(call.getBoolean("plainHttp", false));
        switch (Consent.toConnect(ServerChoice.get(getContext()) != null, plain, plainAgreed)) {
            case REFUSE_PLAIN:
                call.reject("plain http was not agreed to", "plain-http");
                return;
            case ASK:
                String message = getContext().getString(R.string.confirm_connect_body, hostOf(origin)) +
                    (plain ? "\n\n" + getContext().getString(R.string.confirm_connect_plain) : "") +
                    (installedCa ? "\n\n" + getContext().getString(R.string.confirm_connect_installed_ca) : "");
                // A no reloads the page: a server's web build from before api 8 waits on
                // "Connecting..." for good otherwise.
                confirm(call, R.string.confirm_connect_title, message, R.string.confirm_connect_yes,
                    () -> moveTo(call, origin, plain, installedCa), () -> getBridge().getWebView().reload());
                return;
            default:
                moveTo(call, origin, plain, installedCa);
        }
    }

    private void moveTo(PluginCall call, String origin, boolean plain, boolean installedCa) {
        // Another server: a certificate picked for the last one is not offered to it.
        if (!origin.equals(ServerChoice.get(getContext()))) ClientCert.forget(getContext());
        if (plain) ServerChoice.agreePlain(getContext(), origin);
        if (installedCa) ServerChoice.agreeInstalledCa(getContext(), origin);
        ServerChoice.set(getContext(), origin);
        BackgroundCheck.forgetServer(getContext());
        Shortcuts.clear(getContext());
        call.resolve();
        restart();
    }

    /** Back to the app on its own (standalone): the app restarts without a server. Asked first on a server's page (audit A4). */
    @PluginMethod
    public void disconnect(PluginCall call) {
        String server = ServerChoice.get(getContext());
        if (Consent.toDisconnect(server != null) == Consent.Answer.ASK) {
            confirm(call, R.string.confirm_disconnect_title,
                getContext().getString(R.string.confirm_disconnect_body, hostOf(server)),
                R.string.confirm_disconnect_yes, () -> leave(call), () -> {});
            return;
        }
        leave(call);
    }

    private void leave(PluginCall call) {
        ServerChoice.chooseStandalone(getContext());
        BackgroundCheck.forgetServer(getContext());
        Shortcuts.clear(getContext());
        ClientCert.forget(getContext());
        call.resolve();
        restart();
    }

    /** One question at a time: a page asking again while one is open gets a no. */
    private volatile boolean asking;

    /** The app's own dialog, which no page can answer: yes runs {@code onYes}; anything else rejects, then runs {@code onNo}. */
    private void confirm(PluginCall call, int title, String message, int yes, Runnable onYes, Runnable onNo) {
        android.app.Activity activity = getActivity();
        if (activity == null || asking) {
            call.reject("not asked", "cancelled");
            return;
        }
        asking = true;
        activity.runOnUiThread(() -> new androidx.appcompat.app.AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton(yes, (dialog, which) -> onYes.run())
            .setNegativeButton(android.R.string.cancel, (dialog, which) -> {
                call.reject("cancelled", "cancelled");
                onNo.run();
            })
            .setOnCancelListener((dialog) -> {
                call.reject("cancelled", "cancelled");
                onNo.run();
            })
            .setOnDismissListener((dialog) -> asking = false)
            .show());
    }

    private static String hostOf(String origin) {
        return origin.replaceFirst("^https?://", "");
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
                Logger.warn("PeckList: could not start passing the gate: " + error);
            }
        });
    }

    /** Api 3: off the server and onto the app's own connect page (the offline page's "Use another server"). */
    @PluginMethod
    public void chooseServer(PluginCall call) {
        call.resolve();
        getActivity().runOnUiThread(() -> {
            getActivity().setIntent(MainActivity.chooseServer(getContext()));
            getActivity().recreate();
        });
    }

    /**
     * Api 5: Android's notification settings for this app, where each channel (Reminders, Constant
     * reminders, Assignments and dibs, Shares, Comments and mentions) has its own sound, vibration
     * and on or off. PL-115's "Manage on the phone".
     */
    @PluginMethod
    public void notificationSettings(PluginCall call) {
        Channels.ensure(getContext());
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

    /**
     * Api 10: each channel's on or off by kind ({channels: {reminders, constant, assignments, shares,
     * comments}}), and the kinds switched on the phone since the last ask ({changed}), which the web
     * app carries into its synced switches (PL-115). Asking takes the changes.
     */
    @PluginMethod
    public void notificationChannels(PluginCall call) {
        try {
            call.resolve(JSObject.fromJSONObject(Channels.answer(getContext())));
        } catch (JSONException error) {
            call.reject(error.getMessage());
        }
    }

    /**
     * Api 10: one kind's channel in Android's settings ({kind}), where its on or off, sound and
     * vibration are. An unknown kind, or Android before 8, gets the app's notification settings.
     */
    @PluginMethod
    public void openNotificationChannel(PluginCall call) {
        Channels.ensure(getContext());
        String id = Channels.idOf(call.getString("kind", ""));
        if (id == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            notificationSettings(call);
            return;
        }
        Intent intent = new Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
            .putExtra(android.provider.Settings.EXTRA_CHANNEL_ID, id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException missing) {
            notificationSettings(call);
        }
    }

    /**
     * Api 11: the lists the launcher's long-press menu offers ({lists: [{id, name}]}, the one
     * opened last first); an empty list clears them, as after signing out (Shortcuts).
     */
    @PluginMethod
    public void setShortcuts(PluginCall call) {
        try {
            Shortcuts.setLists(getContext(), call.getArray("lists", new com.getcapacitor.JSArray()));
            call.resolve();
        } catch (JSONException | RuntimeException error) {
            call.reject("bad shortcuts: " + error.getMessage(), "invalid");
        }
    }

    /**
     * Api 11: the keyboard up for the field the page just focused. A WebView raises it only for a
     * tap, so the Add task shortcut's focused field would wait for one otherwise.
     */
    @PluginMethod
    public void showKeyboard(PluginCall call) {
        android.webkit.WebView web = getBridge().getWebView();
        android.app.Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        web.post(() -> {
            web.requestFocus();
            androidx.core.view.WindowCompat.getInsetsController(activity.getWindow(), web)
                .show(androidx.core.view.WindowInsetsCompat.Type.ime());
        });
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
                Logger.warn("PeckList", "handed-over tasks unreadable: " + unreadable.getMessage());
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

    /** Api 2: Android's dialog to let PeckList run in the background; resolves once it closes. */
    @PluginMethod
    public void allowBackground(PluginCall call) {
        boolean askedBefore = BackgroundCheck.asked(getContext());
        BackgroundCheck.markAsked(getContext());
        boolean pressed = Boolean.TRUE.equals(call.getBoolean("pressed", false));
        if (BackgroundCheck.unrestricted(getContext())
            || !BackgroundCheck.opensSettings(Distribution.isPlay(), pressed, askedBefore)) {
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

    /** Api 9: whether reminders can go off at the exact minute, and whether there is a page to allow it ({allowed, canAsk}). */
    @PluginMethod
    public void exactAlarms(PluginCall call) {
        call.resolve(ExactAlarms.state(getContext()));
    }

    /** Api 9: Android's page to allow exact alarms (the Play build, Android 14 and up); resolves once it closes. */
    @PluginMethod
    public void allowExactAlarms(PluginCall call) {
        if (!ExactAlarms.canAsk(Build.VERSION.SDK_INT, ExactAlarms.allowed(getContext()))) {
            call.resolve(ExactAlarms.state(getContext()));
            return;
        }
        try {
            startActivityForResult(call, ExactAlarms.allowPage(getContext()), "exactAlarmsAnswered");
        } catch (ActivityNotFoundException error) {
            call.resolve(ExactAlarms.state(getContext()));
        }
    }

    @ActivityCallback
    private void exactAlarmsAnswered(PluginCall call, ActivityResult result) {
        if (ExactAlarms.allowed(getContext())) {
            // CheckReceiver does this too, on Android's broadcast; at once is sooner.
            Reminders.restore(getContext());
            BackgroundCheck.schedule(getContext());
        }
        if (call != null) call.resolve(ExactAlarms.state(getContext()));
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
                    Logger.warn("PeckList: could not start linking " + linking + ": " + error.getMessage());
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
            Logger.warn("PeckList: could not ask " + server + " about app sign-in: " + error.getMessage());
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

    /**
     * Api 3: replace the reminders set ahead ({key, title, body, at, url, constant, repeats}); see
     * Reminders. Api 10: with {@code keep}, add and change them only, taking nothing off.
     */
    @PluginMethod
    public void scheduleReminders(PluginCall call) {
        try {
            boolean keep = Boolean.TRUE.equals(call.getBoolean("keep", false));
            Reminders.handOver(getContext(), Reminders.parse(call.getArray("reminders", new com.getcapacitor.JSArray())), false, keep);
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
                Reminders.showNews(getContext(), tag, call.getString("category", ""), call.getString("title", "PeckList"),
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
        Held.listen(() -> notifyListeners("held", new JSObject(), true));
    }

    /**
     * Api 7: Complete and Snooze pressed on reminders that the web app finishes (standalone, or a
     * server too old to move a repeating task), as {presses: [{action, taskId, minutes, at}]}, and
     * none of them left. A "held" event says more are waiting.
     */
    @PluginMethod
    public void held(PluginCall call) {
        JSObject result = new JSObject();
        result.put("presses", Held.take(getContext()));
        call.resolve(result);
    }

    /**
     * A notification tapped, or one of its buttons that finishes in the app: tell the web app where
     * to go and what to do (retained, so a web app still starting gets it too).
     */
    private boolean opened(Intent intent) {
        String url = intent == null ? null : intent.getStringExtra(Reminders.EXTRA_URL);
        if (url == null || !url.startsWith("/")) return false;
        if (!NotificationToken.carried(getContext(), intent)) {
            // Not from this app (MainActivity is exported): the app opens as it would anyway, and
            // nothing the intent asks for is done. A notification shown before this update has no
            // token either, so it just opens the app, once.
            Logger.info("PeckList", "Ignored a page to open that did not come from this app's notifications");
            forget(intent);
            return true;
        }
        if (!firstPress(intent, url)) {
            intent.removeExtra(Reminders.EXTRA_URL);
            return true;
        }
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
        intent.removeExtra(NotificationToken.EXTRA);
        notifyListeners("notificationOpen", event, true);
        return true;
    }

    /** Drops what a notification's intent asks for, so none of it is acted on later. */
    private static void forget(Intent intent) {
        for (String extra : new String[] { Reminders.EXTRA_URL, Reminders.EXTRA_ACTION, Reminders.EXTRA_TASK,
            Reminders.EXTRA_MINUTES, Reminders.EXTRA_SHOWN, Reminders.EXTRA_PRESS, NotificationToken.EXTRA }) {
            intent.removeExtra(extra);
        }
    }

    /**
     * False for a press handled before, which Android hands back when the app returns from Recents
     * after its process died.
     */
    private boolean firstPress(Intent intent, String url) {
        String press = intent.getStringExtra(Reminders.EXTRA_PRESS);
        if (press == null) press = Presses.idFrom(intent.getAction(), intent.getDataString(), url);
        return Presses.first(getContext(), press);
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
                    Logger.warn("PeckList: the gate's pass did not open: " + error);
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
            Logger.warn("PeckList: a sign-in came back that this app did not start");
            return;
        }
        getBridge().getWebView().post(() -> getBridge().getWebView().postUrl(redeem.url, redeem.body));
    }

    @Override
    protected void handleOnDestroy() {
        Held.listen(null);
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
