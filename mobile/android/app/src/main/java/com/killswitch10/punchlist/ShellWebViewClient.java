package com.killswitch10.punchlist;

import android.content.Context;
import android.text.TextUtils;
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
 * reach the PunchlistShell plugin.
 */
class ShellWebViewClient extends BridgeWebViewClient {

    private final Context context;

    ShellWebViewClient(Bridge bridge) {
        super(bridge);
        this.context = bridge.getContext();
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

    private void showOffline(WebView view, WebResourceRequest request) {
        String server = ServerChoice.get(context);
        if (server == null || !ServerChoice.sameOrigin(server, request.getUrl().toString())) return;
        view.loadDataWithBaseURL(server + "/", page(server), "text/html", "utf-8", null);
    }

    private String page(String server) {
        String host = server.replaceFirst("^https?://", "");
        // The server address is only ever an origin (ServerChoice.normalize), so it is safe in JS.
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
            "</style></head><body><main>" +
            "<h1>" + TextUtils.htmlEncode(context.getString(R.string.offline_title)) + "</h1>" +
            "<p>" + TextUtils.htmlEncode(context.getString(R.string.offline_body, host)) + "</p>" +
            "<button class=\"go\" onclick=\"location.replace('" + server + "/')\">" +
            TextUtils.htmlEncode(context.getString(R.string.offline_retry)) + "</button>" +
            "<button class=\"other\" id=\"other\" hidden>" + TextUtils.htmlEncode(context.getString(R.string.offline_other)) + "</button>" +
            "</main><script>" +
            "var c=window.Capacitor;var b=document.getElementById('other');" +
            "if(c&&c.nativePromise){b.hidden=false;b.onclick=function(){c.nativePromise('PunchlistShell','disconnect',{})}}" +
            "</script></body></html>"
        );
    }
}
