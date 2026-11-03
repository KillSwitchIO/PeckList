package com.killswitch10.pecklist;

import android.content.Context;
import com.getcapacitor.CapConfig;
import com.getcapacitor.Logger;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Capacitor's config with the chosen server filled in at start (ADR-0017). capacitor.config.ts
 * cannot know the server, since each person picks their own, so the bundled config is copied with
 * {@code server.url} set and loaded from there. Capacitor then injects its bridge into that origin
 * only, and the WebView talks to the server directly: cookies, live updates and the service worker
 * behave as they do in a browser.
 */
final class RuntimeConfig {

    private static final String BUNDLED = "capacitor.config.json";
    private static final String FOLDER = "runtime-config";

    private RuntimeConfig() {}

    static CapConfig load(Context context, String server) {
        if (server == null) return CapConfig.loadDefault(context);
        try {
            JSONObject json = new JSONObject(readAsset(context, BUNDLED));
            JSONObject serverSection = json.optJSONObject("server");
            if (serverSection == null) serverSection = new JSONObject();
            serverSection.put("url", server);
            json.put("server", serverSection);
            File folder = new File(context.getFilesDir(), FOLDER);
            if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("cannot create " + folder);
            try (FileOutputStream out = new FileOutputStream(new File(folder, BUNDLED))) {
                out.write(json.toString().getBytes(StandardCharsets.UTF_8));
            }
            return CapConfig.loadFromFile(context, folder.getAbsolutePath());
        } catch (IOException | JSONException error) {
            // Better the standalone app than none: the person can connect again from there.
            Logger.error("PeckList: could not point the app at " + server, error);
            return CapConfig.loadDefault(context);
        }
    }

    private static String readAsset(Context context, String name) throws IOException {
        try (InputStream in = context.getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            for (int count; (count = in.read(buffer)) != -1; ) out.write(buffer, 0, count);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
