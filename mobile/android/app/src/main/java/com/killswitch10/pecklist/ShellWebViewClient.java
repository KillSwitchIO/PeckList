package com.killswitch10.pecklist;

import android.app.Activity;
import android.content.Context;
import android.text.TextUtils;
import android.webkit.ClientCertRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Capacitor's WebView client, plus a page of our own when the server cannot be reached on a
 * start with nothing cached yet (once the app has loaded, its service worker serves it offline).
 * Capacitor's own error page would load at https://localhost, where the bridge is not injected in
 * server mode; this one is shown at the server's origin, so its "Use another server" button can
 * reach the PeckListShell plugin.
 */
class ShellWebViewClient extends BridgeWebViewClient {

    private final Context context;
    private final Activity activity;

    ShellWebViewClient(Bridge bridge) {
        super(bridge);
        this.context = bridge.getContext();
        this.activity = bridge.getActivity();
    }

    /** The server (or its proxy) wants a client certificate: mutual TLS (R-FB-158). */
    @Override
    public void onReceivedClientCertRequest(WebView view, ClientCertRequest request) {
        if (activity == null) {
            request.cancel();
            return;
        }
        ClientCert.answer(activity, request);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(view, request, error);
        if (request.isForMainFrame()) showOffline(view, request);
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        super.onReceivedHttpError(view, request, response);
        // A proxy that cannot reach the server answers for it; any other status is the server's own.
        int status = response.getStatusCode();
        if (request.isForMainFrame() && (status == 502 || status == 503 || status == 504)) showOffline(view, request);
    }

    /**
     * The server sent the WebView to another site first: a sign-in page in front of it (Gate). A
     * provider's own pages, while one runs in the WebView, are let through (ShellPlugin).
     */
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        String server = ServerChoice.get(context);
        String url = request.getUrl().toString();
        String scheme = request.getUrl().getScheme();
        if (server != null && request.isForMainFrame() && request.isRedirect() && !ShellPlugin.lettingThrough()
            && ("https".equals(scheme) || "http".equals(scheme)) && Gate.elsewhere(server, url)) {
            showGate(view);
            return true;
        }
        return super.shouldOverrideUrlLoading(view, request);
    }

    private void showOffline(WebView view, WebResourceRequest request) {
        String server = ServerChoice.get(context);
        if (server == null || !ServerChoice.sameOrigin(server, request.getUrl().toString())) return;
        String host = server.replaceFirst("^https?://", "");
        // The server address is only ever an origin (ServerChoice.normalize), so it is safe in JS.
        view.loadDataWithBaseURL(server + "/", card(
            context.getString(R.string.offline_title),
            context.getString(R.string.offline_body, host),
            "<button class=\"go\" onclick=\"location.replace('" + server + "/')\">" + E(R.string.offline_retry) + "</button>" +
            shellButton("other", R.string.offline_other, "chooseServer", "{}")
        ), "text/html", "utf-8", null);
    }

    /** Sign in to the gate in a browser tab (passkeys work there), or here when it has none. */
    void showGate(WebView view) {
        String server = ServerChoice.get(context);
        if (server == null) return;
        String host = server.replaceFirst("^https?://", "");
        view.post(() -> view.loadDataWithBaseURL(server + "/", card(
            context.getString(R.string.gate_title),
            context.getString(R.string.gate_body, host),
            shellButton("go", R.string.gate_sign_in, "passGate", "{}") +
            shellButton("other", R.string.gate_here, "passGate", "{inApp:true}") +
            // A gate that keeps its cookie to itself (Pangolin): a share link for this server,
            // loaded here once, gives this WebView the gate's session the way a browser gets it.
            "<label class=\"shell\" hidden>" + E(R.string.gate_link_hint) +
            "<input id=\"link\" type=\"url\" inputmode=\"url\" autocomplete=\"off\" placeholder=\"https://\"></label>" +
            "<button class=\"other shell\" hidden onclick=\"Capacitor.nativePromise('PeckListShell','passGate',{link:document.getElementById('link').value})\">" +
            E(R.string.gate_link_use) + "</button>" +
            shellButton("other", R.string.offline_other, "chooseServer", "{}")
        ), "text/html", "utf-8", null));
    }

    /** A button that asks the shell (hidden until the bridge is there). */
    private String shellButton(String kind, int label, String method, String options) {
        return "<button class=\"" + kind + " shell\" hidden onclick=\"Capacitor.nativePromise('PeckListShell','" + method + "'," + options + ")\">" +
            E(label) + "</button>";
    }

    private String E(int text) {
        return TextUtils.htmlEncode(context.getString(text));
    }

    private static String card(String title, String body, String buttons) {
        return (
            "<!doctype html><html><head><meta charset=\"utf-8\">" +
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
            "<style>" +
            ":root{color-scheme:light dark;--bg:#FAFAF7;--card:#fff;--text:#1F2421;--muted:#5E6662;--line:#DADDD8;--accent:#4F8F87;--on:#fff}" +
            "@media (prefers-color-scheme:dark){:root{--bg:#1B1D1F;--card:#232628;--text:#E6E9E6;--muted:#A3ABA7;--line:#33383A;--accent:#7FBFB6;--on:#0E1A18}}" +
            "body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);" +
            "font:16px/1.5 system-ui,Roboto,sans-serif;padding:16px;box-sizing:border-box}" +
            "main{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px 24px;box-sizing:border-box}" +
            "h1{font-size:1.375rem;margin:0 0 4px}p{color:var(--muted);margin:0 0 24px;font-size:.875rem}" +
            "button{width:100%;border:0;border-radius:8px;padding:12px 16px;font:inherit;font-weight:600;cursor:pointer}" +
            ".go{background:var(--accent);color:var(--on)}.other{background:none;color:var(--accent);margin-top:8px}" +
            "label{display:block;margin-top:20px;font-size:.875rem;color:var(--muted)}" +
            "input{display:block;width:100%;margin-top:6px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;" +
            "font:inherit;box-sizing:border-box;background:var(--bg);color:var(--text)}" +
            "</style></head><body><main>" +
            "<h1>" + TextUtils.htmlEncode(title) + "</h1>" +
            "<p>" + TextUtils.htmlEncode(body) + "</p>" +
            buttons +
            "</main><script>" +
            "if(window.Capacitor&&Capacitor.nativePromise){document.querySelectorAll('.shell').forEach(function(b){b.hidden=false})}" +
            "</script></body></html>"
        );
    }
}
