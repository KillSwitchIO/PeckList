# Android app

The Android app lives in `mobile/`: a [Capacitor](https://capacitorjs.com) 8 shell around the web
app (ADR-0017 in the project notes). There is no second copy of the UI.

## How it works

- **No server chosen**: the WebView runs the web build bundled into the app, at
  `https://localhost`, with data on the phone only.
- **Connected**: `MainActivity` points Capacitor at the server (`server.url`, set at start from the
  saved address). The WebView then loads that server's own web build, so cookies, live updates and
  the service worker work as in a browser, and the app always matches its server's version.
  Capacitor injects its bridge into that origin only.
- **`PunchlistShell` plugin** (`ShellPlugin.java`, used through `web/src/adapters/capacitor-shell.ts`):
  `info`, `checkServer`, `connect`, `disconnect`. The web build a server ships can be older or
  newer than the shell, so methods are only ever added and `info().api` says which exist.
- **Back button**: `MainActivity` asks the web app first (`window.punchlistBack()`,
  `web/src/app/native/back.ts`): it closes the topmost menu, dialog or sheet, else steps back in
  the app's history. With nothing left, the app moves to the background. A server's web build too
  old to answer gets the WebView's own history instead.
- **Server unreachable on a cold start** (nothing cached by the service worker yet, or a proxy
  answering 502/503/504): `ShellWebViewClient` shows a page at the server's origin with **Try
  again** and **Use another server**. Once the app has loaded, its service worker serves it offline.
- **Reminders**: the WebView has no notifications and no Web Push, so the app hands the next two
  weeks of reminders (at most 100) to Android through Capacitor's Local Notifications whenever
  they change (`web/src/adapters/capacitor-notifier.ts`). They fire with exact alarms
  (`USE_EXACT_ALARM`) even with the app closed, in a "Reminders" channel; a tap opens the task.
  Reminders further out are handed over the next time the app opens.
- **Icon and launch screen**: vector drawables drawn from `web/public/icon.svg` (adaptive icon
  with a monochrome layer for themed icons, and a legacy one for Android 7); the launch screen
  uses the web app's background colors, light and dark.
- **Provider sign-in**: the plugin catches the WebView's move to `/auth/oidc/<name>/login` and
  opens `/auth/app/handoff` in a Custom Tab instead, with a PKCE challenge. The server signs the
  tab in through the provider, asks the person to confirm, and sends the tab to
  `<package>://auth?code=...`. The app posts the code and its verifier to `/auth/app/redeem` in the
  WebView, which gets a copy of the tab's session. See `server/src/Punchlist.Server/Auth/AppSignIn.cs`.

## Building

You need JDK 21 and the Android SDK (platform 36, build tools 36). Point `ANDROID_HOME` at the SDK.

```bash
pnpm install
pnpm --filter @punchlist/mobile apk
```

That builds the web app, copies it into the Android project (`cap sync`) and builds
`mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Install it with
`adb install -r <apk>`. Unit tests for the native code:

```bash
cd mobile/android && ./gradlew testDebugUnitTest
```

CI builds the debug APK in the `android-apk` job (manual on main and merge requests), and the
signed release APK in `android-release` (automatic on tags, manual on main).

## Release signing

Android only installs an update signed with the same key as the installed app, so the release key
must never change or be lost. Debug and release builds have different keys: a phone with the debug
build needs it uninstalled before the release one goes on.

| Where | What |
| --- | --- |
| GitLab, project CI/CD variables | `ANDROID_KEYSTORE_BASE64` (the PKCS12 keystore, base64; protected, masked), `ANDROID_KEYSTORE_PASSWORD` (protected, masked), `ANDROID_KEY_ALIAS` (`punchlist`, protected) |
| GitLab, protected tags | `v*`, so tag pipelines get the protected variables (only `main` and `v*` tags can sign) |
| A password manager | The keystore file and its password: the copy to restore from |

The key: RSA 4096, alias `punchlist`, `CN=Punchlist, O=killswitch10`, valid 100 years,
certificate SHA-256 `18:C8:C5:CE:EE:2E:8C:5D:DD:2E:BE:E6:7A:F8:B6:AA:E5:88:0C:65:65:2D:0C:56:81:85:15:88:4F:3B:BD:CA`.
A PKCS12 keystore has one password for the store and the key.

`mobile/android/app/build.gradle` signs a release build when `ANDROID_KEYSTORE_FILE` is set, with
`ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS` (and `ANDROID_KEY_PASSWORD` if it ever differs).
`PUNCHLIST_VERSION` sets the version name and `PUNCHLIST_VERSION_CODE` the version code; CI uses
the pipeline number, which only grows. A signed build by hand:

```bash
export ANDROID_KEYSTORE_FILE=/path/to/punchlist-release.p12 ANDROID_KEYSTORE_PASSWORD=...
PUNCHLIST_VERSION=0.2.0 PUNCHLIST_VERSION_CODE=1000 pnpm --filter @punchlist/mobile exec node scripts/gradle.mjs assembleRelease
apksigner verify --print-certs mobile/android/app/build/outputs/apk/release/app-release.apk
```

A new key (only if the old one is lost, and every install must then be removed first):

```bash
keytool -genkeypair -keystore punchlist-release.p12 -storetype PKCS12 -alias punchlist \
  -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Punchlist, O=killswitch10"
base64 -w0 punchlist-release.p12   # the value of ANDROID_KEYSTORE_BASE64
```

If the app goes on Google Play, enrol in Play App Signing with this key as the upload key.

## Trying it against a local server

From the emulator, the computer is `10.0.2.2`, so a server published on port 8080 is
`10.0.2.2:8080` on the connect page (it warns about plain HTTP). For provider sign-in, the
provider must be reachable at the same address from the server and from the emulator.

## Not done yet

A native storage adapter, and linking a provider account from Settings (that flow still runs
inside the WebView).
