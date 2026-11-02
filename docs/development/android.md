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
- **Linking a provider from Settings**: the browser tab is not signed in as the app is, so the
  plugin first asks for a one-time code with the app's own session (`POST /auth/app/link-start`),
  opens `/auth/app/link?code=...` in a Custom Tab, and the server sends the outcome to
  `<package>://link?result=...`, which reopens Settings with it.
- **Back button**: `MainActivity` asks the web app first (`window.punchlistBack()`,
  `web/src/app/native/back.ts`): it closes the topmost menu, dialog or sheet, else steps back in
  the app's history. With nothing left, a second Back within two seconds moves the app to the
  background ("Press Back again to leave Punchlist"). A server's web build too old to answer gets
  the WebView's own history instead.
- **System bars**: Android 15 draws apps under the status and navigation bars, and on WebView 140
  and later Capacitor leaves the space to the page's CSS, which an older server's web build does
  not handle. So Capacitor's handling is off (`SystemBars.insetsHandling: 'disable'`) and
  `MainActivity` pads the window itself (bars, cutout and keyboard), with the app's background
  behind the bars; the page sees no insets.
- **Pull to refresh**: pulling down at the top syncs, with a Chrome-like circle
  (`web/src/app/sync/PullToRefresh.tsx`, also in an installed web app). The WebView's own
  overscroll stretch is off: it dragged the fixed bottom bar along.
- **A sign-in page in front of the server** (Pangolin, Cloudflare Access, Authelia, Authentik):
  the WebView is redirected to another site, which Capacitor would open in the browser, and the
  gate's sign-in (often a passkey) does not work in a WebView anyway. So the app notices the
  redirect (`ShellWebViewClient`, and `Gate.gated` on start for a cached app) and shows a page of
  its own: **Sign in** opens `/auth/app/gate` in a browser tab with a fresh RSA public key; past the
  gate, our server (`AppGate.cs`) confirms like app sign-in and sends the gate's cookies back to
  `<package>://gate`, sealed to that key (RSA-OAEP-SHA256 around AES-256-GCM); `Gate` puts them in
  the WebView's cookies for a month (the gate asks again when its own session ends). **Sign in here
  instead** signs in to the gate inside the WebView, for a gate without passkeys or a server too
  old for `/auth/app/gate`. The connect page says when an address is gated (`ServerCheck`, `gated`).
  **A share link** (`passGate` with `link`, for Pangolin, which strips its session cookie before
  the request reaches the server, so the hand-back can never carry it): the link, on the server's
  host, is loaded in the WebView once; the gate answers with its cookie and sends the WebView on.
- **Getting off a server**: the connect page always offers **Use on this device only**; the
  offline page's **Use another server** and the launcher icon's long-press shortcut **Change
  server** (`res/xml/shortcuts.xml`) leave the server for the app's own connect page, whatever the
  server's web build is. Leaving on purpose is remembered (`choseStandalone` in `info()`), so the
  server-less app does not open on the connect page.
- **Server unreachable on a cold start** (nothing cached by the service worker yet, or a proxy
  answering 502/503/504): `ShellWebViewClient` shows a page at the server's origin with **Try
  again** and **Use another server**. Once the app has loaded, its service worker serves it offline.
- **Reminders**: the WebView has no notifications and no Web Push, so the app hands the next two
  weeks of reminders (at most 100) to the shell whenever they change
  (`web/src/adapters/shell-notifier.ts`, shell api 3; an older shell gets them through Capacitor's
  Local Notifications instead). `Reminders` sets an exact alarm for each (`USE_EXACT_ALARM`) and
  shows it when it fires, in a "Reminders" channel, with **Complete** and **Snooze** as TickTick
  has. A constant reminder is insistent (it keeps sounding until touched) and a quiet copy
  replaces it after 30 minutes; its 5-minute repeats are for browsers and are skipped here.
  News goes to a channel per kind ("Assignments and dibs", "Shared lists", "Comments and
  mentions"), all with vibration on (PL-115); the channel ids are versioned (`.v2`) because
  Android keeps a channel's settings as first created, and the first ones had no vibration. Snooze asks how long first (`SnoozeActivity`, a dialog over whatever is on screen: 10 or 30
  minutes, 1 or 3 hours, tomorrow at 9:00, or a time). On a server the buttons act there
  (`POST /api/reminders/act`, `ReminderReceiver`) without opening the app, and take effect on the
  phone at once; offline, the press waits in `Pending` and goes at the next check-in or start, with
  no second notification. Standalone, or Complete on a repeating task (only the app works out its
  next date), the button opens the app and does it there (`app/native/NotificationOpen.tsx`). A tap
  opens the task.
  Reminders further out are handed over by the background check-in.
- **Background check-in** (instead of Web Push): with the app closed, an exact alarm wakes
  `CheckReceiver` every 5 minutes (Settings > Notifications: off, or 15, 30 or 60 minutes). It
  asks `GET /api/app/check` with the WebView's session cookie and gets what is new since its last
  check (shares, assignments, mentions, worded as the push is) and the next two weeks of
  reminders. `Reminders` shows the new ones in a "Shares, assignments and mentions" channel and
  sets the reminders the same way the web app does, keyed alike (`taskId@first`, `#n` on a constant
  reminder's repeats), so a reminder changed on another device fires here and one set by both is
  one. While the app is on screen the web app owns both, and the check
  only moves its cursor; news the web app's own sync brings then goes through `showNotification`
  with `news: true` (shell api 4), shown the same way and keyed by the same server id, so the two
  never show one piece of news twice. Once signed in, the app asks once to notify and to run without battery
  optimization (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`); without that, Android holds the alarm and
  the network while the phone is idle. Samsung phones also need Punchlist in **Never sleeping
  apps**, which the settings say. Google Play allows that permission only for some kinds of app,
  so a Play build would drop it and check every 15 minutes with WorkManager.
  `notificationSettings` (shell api 5) opens Android's notification settings for the app, where
  each channel has its own sound and vibration; Settings > Notifications offers it as **Manage on
  the phone**.
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

## Notification drill

`scripts/notification-drill.mjs` makes every kind of notification happen for one person from the
outside, so each can be watched arriving on a phone or in a browser: a second account (an admin,
through an API key with `tasks:write`, `notifications` and `admin`) shares a list, assigns a task
to the person and to a group, calls dibs, comments, edits the comment, mentions them, and sets
reminders that fire a few minutes later (plain, constant, repeating, all-day). The person only
watches the device and presses the buttons on the notifications; `status` then shows what those
presses did on the server, and `cleanup` deletes everything the drill made.

```bash
PUNCHLIST_URL=https://tasks.example.com PUNCHLIST_TOKEN_FILE=~/.punchlist-drill.token PUNCHLIST_TARGET=ben node scripts/notification-drill.mjs setup
node scripts/notification-drill.mjs reminder 7          # reminds in 7 minutes
node scripts/notification-drill.mjs reminder 7 --constant
node scripts/notification-drill.mjs --help
```

`PUNCHLIST_ZONE` (default `America/Chicago`) must be the person's time zone, since reminders are
local times. The Android app learns of a reminder at its next check-in, so leave more than the
check-in interval before the time; a browser with push on gets it from the server at the time.
Every entity the drill pushes is checked against `schema/workspace.schema.json` first, because a
field the schema does not know would stop the person's app from opening its data.

## Not done yet

A native storage adapter. Notifications from the server arrive within the check-in interval, not
at once: instant ones would need a push service (UnifiedPush or FCM).
