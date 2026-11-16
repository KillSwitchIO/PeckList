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
- **`PeckListShell` plugin** (`ShellPlugin.java`, used through `web/src/adapters/capacitor-shell.ts`):
  `info`, `checkServer`, `connect`, `disconnect`. The web build a server ships can be older or
  newer than the shell, so methods are only ever added and `info().api` says which exist.
- **Linking a provider from Settings**: the browser tab is not signed in as the app is, so the
  plugin first asks for a one-time code with the app's own session (`POST /auth/app/link-start`),
  opens `/auth/app/link?code=...` in a Custom Tab, and the server sends the outcome to
  `<package>://link?result=...`, which reopens Settings with it.
- **Back button**: `MainActivity` asks the web app first (`window.pecklistBack()`,
  `web/src/app/native/back.ts`): it closes the topmost menu, dialog or sheet, else steps back in
  the app's history. With nothing left, a second Back within two seconds moves the app to the
  background ("Press Back again to leave PeckList"). A server's web build too old to answer gets
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
  no second notification. A snooze on a server is the person's own: the server keeps it apart from
  the task (`reminder_snoozes`), so nobody else on the task gets it, and hands it to their next check
  with the reminders ahead (`GET /api/reminders/snoozes` lists it for an open web app). Standalone, or Complete on a repeating task (only the app works out its
  next date), the button opens the app and does it there (`app/native/NotificationOpen.tsx`). A tap
  opens the task.
  Reminders further out are handed over by the background check-in.
- **Background check-in** (instead of Web Push): with the app closed, an exact alarm wakes
  `CheckReceiver` every 5 minutes (Settings > Notifications: off, or 15, 30 or 60 minutes). It
  asks `GET /api/app/check` with the WebView's session cookie and gets what is new since its last
  check (shares, assignments, mentions, worded as the push is) and the next two weeks of
  reminders. It sends the device's time zone (`zone`), which the server keeps as the person's device
  zone, so a trip moves server reminders without the app being opened. `Reminders` shows the new ones in a "Shares, assignments and mentions" channel and
  sets the reminders the same way the web app does, keyed alike (`taskId@first`, `#n` on a constant
  reminder's repeats), so a reminder changed on another device fires here and one set by both is
  one. While the app is on screen the web app owns both, and the check
  only moves its cursor (it sends `reminders=0`, so the server skips working them out); news the web app's own sync brings then goes through `showNotification`
  with `news: true` (shell api 4), shown the same way and keyed by the same server id, so the two
  never show one piece of news twice. Once signed in, the app asks once to notify and to run without battery
  optimization (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`); without that, Android holds the alarm and
  the network while the phone is idle. Samsung phones also need PeckList in **Never sleeping
  apps**, which the settings say. Google Play allows that permission only for some kinds of app,
  so a Play build would drop it and check every 15 minutes with WorkManager.
  `notificationSettings` (shell api 5) opens Android's notification settings for the app, where
  each channel has its own sound and vibration; Settings > Notifications offers it as **Manage on
  the phone**.
  **Tasks made without a server** (shell api 6, PL-070): the connect page hands the bundled
  build's workspace to `carry` (with the server it is for) before `connect`; the shell keeps it in
  app-private `carried.json` and gives it back through `carried` only while connected to that
  server. After sign-in the server's build asks the join question (`join: 'phone'`), imports on
  yes like **Import a file**, and calls `clearCarried` either way; the bundled build's own
  storage is never touched.
  **Reminder buttons never open the app** (shell api 7, PL-061): on a server, Complete and Snooze
  post `/api/reminders/act`, and the server moves a repeating task itself (`RepeatingTask`, the
  C# twin of `repeatTask`; both pass `schema/fixtures/recurrence`). Standalone, or when an older
  server answers 409 for a repeating task, the shell holds the press (`Held`, per server) and the
  web app takes it through `held` when the workspace loads, when it comes back on screen, and on
  the `held` event, completing as of the press time.
- **Icon and launch screen**: vector drawables drawn from `web/public/icon.svg` (adaptive icon
  with a monochrome layer for themed icons, and a legacy one for Android 7); the launch screen
  uses the web app's background colors, light and dark.
- **Provider sign-in**: the plugin catches the WebView's move to `/auth/oidc/<name>/login` and
  opens `/auth/app/handoff` in a Custom Tab instead, with a PKCE challenge. The server signs the
  tab in through the provider, asks the person to confirm, and sends the tab to
  `<package>://auth?code=...`. The app posts the code and its verifier to `/auth/app/redeem` in the
  WebView, which gets a copy of the tab's session. See `server/src/PeckList.Server/Auth/AppSignIn.cs`.

## Building

You need JDK 21 and the Android SDK (platform 36, build tools 36). Point `ANDROID_HOME` at the SDK.

```bash
pnpm install
pnpm --filter @pecklist/mobile apk
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
| GitLab, project CI/CD variables | `ANDROID_KEYSTORE_BASE64` (the PKCS12 keystore, base64; protected, masked), `ANDROID_KEYSTORE_PASSWORD` (protected, masked), `ANDROID_KEY_ALIAS` (`pecklist`, protected) |
| GitLab, protected tags | `v*`, so tag pipelines get the protected variables (only `main` and `v*` tags can sign) |
| A password manager | The keystore file and its password: the copy to restore from |

The key: RSA 4096, alias `pecklist`, `CN=Punchlist, O=killswitch10` (made before the rename; the
name in a certificate can't change without a new key, and every install would have to be removed
for that), valid 100 years,
certificate SHA-256 `18:C8:C5:CE:EE:2E:8C:5D:DD:2E:BE:E6:7A:F8:B6:AA:E5:88:0C:65:65:2D:0C:56:81:85:15:88:4F:3B:BD:CA`.
A PKCS12 keystore has one password for the store and the key.

`mobile/android/app/build.gradle` signs a release build when `ANDROID_KEYSTORE_FILE` is set, with
`ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS` (and `ANDROID_KEY_PASSWORD` if it ever differs).
The version name is in `mobile/android/app/version.properties`, which `pnpm release` writes with
the other version files, and `PECKLIST_VERSION` overrides it: CI sets it from
`scripts/build-version.sh`, so an APK says the same version as the image from its commit
(`0.8.0-rc.1.edge.818317a7`). A debug build by hand adds `-dev`. The version code follows from the
version name, so every release has a higher one and an rc sorts before its release:

| Version         | Version code                                      |
| --------------- | ------------------------------------------------- |
| `0.12.0-rc.2`   | `1200002`: MAJOR × 10,000,000 + MINOR × 100,000 + PATCH × 1,000 + N |
| `0.12.0`        | `1200999`: the release itself is 999              |
| `0.12.1-edge.…` | `1201000`: a build between releases is 0          |

`version.properties` holds the code too, for F-Droid, and `pnpm check:version` and the release
guard fail when the two disagree. Signed builds between releases (`android-release` by hand on
`main`) share one code until the next release, since the code ignores the commit: each installs
over the other, newer or older, so keep them for trying a build, never for anyone's phone. The
debug APKs set `PECKLIST_VERSION_CODE` to the pipeline number instead, so each installs over the
one before. A signed build by hand:

```bash
export ANDROID_KEYSTORE_FILE=/path/to/pecklist-release.p12 ANDROID_KEYSTORE_PASSWORD=...
pnpm --filter @pecklist/mobile exec node scripts/gradle.mjs assembleRelease
apksigner verify --print-certs mobile/android/app/build/outputs/apk/release/app-release.apk
```

A new key (only if the old one is lost, and every install must then be removed first):

```bash
keytool -genkeypair -keystore pecklist-release.p12 -storetype PKCS12 -alias pecklist \
  -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=PeckList, O=killswitch10"
base64 -w0 pecklist-release.p12   # the value of ANDROID_KEYSTORE_BASE64
```

If the app goes on Google Play, enrol in Play App Signing with this key as the upload key.

## F-Droid

F-Droid builds each release tag from source and ships our own signed APK when its build matches
ours byte for byte apart from the signature (a reproducible build). Its recipe sets nothing but the
revision, so what a release APK holds must come from the tagged files alone:

- **The version** from `version.properties`, as above. The release job stamps the same version.
- **No build-specific data**: the release build leaves out the commit hash (`vcsInfo`) and
  Google's encrypted dependency block (`dependenciesInfo`), and nothing from Google Play Services.
- **The same web app**: F-Droid builds `web/` with the same lockfile and Node 24, and sets
  `PECKLIST_REVISION` to the tagged commit as CI does. The recipe pins a Node patch release while
  the image's `node:24` floats; Vite's output has not depended on the patch so far, but if a
  release ever fails F-Droid's check, set the recipe to the version the image used and look there
  first.
- **Where to find ours**: a final release's APK is also uploaded under its plain version
  (`packages/generic/pecklist/<version>/pecklist-android-<version>.apk`), the address in the
  recipe's `Binaries:` line. It is for F-Droid only: people download from the release page, and
  the release checklist compares that file with the signed `SHA256SUMS`.

To check a change keeps the build reproducible, build the release APK unsigned twice, in different
folders and with nothing stamped the second time, and compare the two files: they must be
identical.

The store listing is in `fastlane/metadata/android/en-US/` at the top of the repository: the
title, the short description (80 characters at most), the full description (4,000), the icon and
the phone screenshots (1170×2532, the demo seed signed in as `demo-sam`).

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
PECKLIST_URL=https://tasks.example.com PECKLIST_TOKEN_FILE=~/.pecklist-drill.token PECKLIST_TARGET=sam node scripts/notification-drill.mjs setup
node scripts/notification-drill.mjs reminder 7          # reminds in 7 minutes
node scripts/notification-drill.mjs reminder 7 --constant
node scripts/notification-drill.mjs --help
```

`PECKLIST_ZONE` (default `America/Chicago`) must be the person's time zone, since reminders are
local times. The Android app learns of a reminder at its next check-in, so leave more than the
check-in interval before the time; a browser with push on gets it from the server at the time.
Every entity the drill pushes is checked against `schema/workspace.schema.json` first, because a
field the schema does not know would stop the person's app from opening its data.

## Not done yet

A native storage adapter. Notifications from the server arrive within the check-in interval, not
at once: instant ones would need a push service (UnifiedPush or FCM).
