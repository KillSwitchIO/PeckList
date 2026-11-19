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
  Local Notifications instead). `Reminders` sets an exact alarm for each (`ExactAlarms`; inexact
  while the Play build waits for the person's allow, see [Two builds](#two-builds)) and
  shows it when it fires, in a "Reminders" channel, with **Complete** and **Snooze** as TickTick
  has. A constant reminder is insistent (it keeps buzzing until touched) on its own "Constant
  reminders" channel (`constant.v1`), made with no sound because `FLAG_INSISTENT` repeats the
  channel's sound as well as its vibration; a quiet copy replaces it on that channel after 30
  minutes. Its 5-minute repeats are for browsers and are skipped here.
  News goes to a channel per kind ("Assignments and dibs", "Shared lists", "Comments and
  mentions"), all with vibration on (PL-115); the channel ids are versioned (`.v2`) because
  Android keeps a channel's settings as first created, and the first ones had no vibration. Snooze asks how long first (`SnoozeActivity`, a dialog over whatever is on screen: 10 or 30
  minutes, 1 or 3 hours, tomorrow at 9:00, or a time). On a server the buttons act there
  (`POST /api/reminders/act`, `ReminderReceiver`) without opening the app, and take effect on the
  phone at once; offline, the press waits in `Pending` and goes at the next check-in or start, with
  no second notification. A snooze on a server is the person's own: the server keeps it apart from
  the task (`reminder_snoozes`), so nobody else on the task gets it, and hands it to their next check
  with the reminders ahead (`GET /api/reminders/snoozes` lists it for an open web app). It is
  for the occurrence snoozed: once the task is done, trashed, moved to another date (a repeating
  task completed moves to its next one) or left with no reminder, it goes from both lists, and the
  next hand-over takes it off the phone's alarms. Standalone, or Complete on a repeating task (only the app works out its
  next date), the button opens the app and does it there (`app/native/NotificationOpen.tsx`). A tap
  opens the task.
  Reminders further out are handed over by the background check-in.
- **Background check-in** (instead of Web Push): with the app closed, an exact alarm wakes
  `CheckReceiver` every 5 minutes (Settings > Notifications: off, or 15, 30 or 60 minutes). It
  asks `GET /api/app/check` with the WebView's session cookie and gets what is new since its last
  check (shares, assignments, mentions, worded as the push is) and the next two weeks of
  reminders. It sends the device's time zone (`zone`), which the server keeps as the person's device
  zone, so a trip moves server reminders without the app being opened (set times and all-day dates;
  a reminder counted from a timed date is worked out on that date's own zone's clock, by the server
  as by the web app, so the check-in hands over the alarm the web app set). `Reminders` shows the
  new ones in a "Shares, assignments and mentions" channel and sets the reminders the same way the
  web app does, keyed alike (`taskId@first`, `#n` on a constant
  reminder's repeats), so a reminder changed on another device fires here and one set by both is
  one. While the app is on screen the web app owns both, and the check
  only moves its cursor (it sends `reminders=0`, so the server skips working them out); news the web app's own sync brings then goes through `showNotification`
  with `news: true` (shell api 4), shown the same way and keyed by the same server id, so the two
  never show one piece of news twice. Once signed in, the app asks once to notify and to run without battery
  optimization (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`; the Play build opens the list of apps
  instead, see [Two builds](#two-builds)); without that, Android holds the alarm and the network
  while the phone is idle. Samsung phones also need PeckList in **Never sleeping apps**, which the
  settings say.
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
  A copy keeps the tab's sign-in time, which may be long ago, so deleting an account without a
  password (it needs a sign-in in the last 10 minutes) starts the provider's sign-in with `fresh=1`:
  the shell passes it on to the hand-off (shell api 9), which ends the tab's own session and has
  the provider (or the passkey) sign the person in again.

## Two builds

The app is built two ways from the same code, as Gradle product flavors (`productFlavors` in
`mobile/android/app/build.gradle`), with the same app ID (`com.pecklist.app`) and the same signing
key, so either installs over the other and keeps its data:

| | `foss` (the default) | `play` |
| --- | --- | --- |
| What | The APK on the GitLab releases, Obtainium, F-Droid and IzzyOnDroid | The bundle (AAB) uploaded to Google Play |
| Exact reminders | `USE_EXACT_ALARM`, granted at install | `SCHEDULE_EXACT_ALARM` only: on Android 14 and later, off until the person allows it |
| Battery optimization | Asks once with Android's dialog (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) | No permission: **Allow** opens Android's list of apps, where the person picks PeckList |
| Payment links | Opened in the browser | Never opened (`PaymentLinks`) |

Google Play allows `USE_EXACT_ALARM` and `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` only for some kinds
of app, and lets an app take money only through Play. So the foss build's extra permissions are in
`src/foss/AndroidManifest.xml`, and `src/play/AndroidManifest.xml` removes them whatever a library
asks for. The release job checks the Play build's merged manifest holds neither.

What changes in the Play build:

- **Exact reminders.** Without leave, `Reminders` and the check-in set inexact alarms, which
  Android may hold back a while. `exactAlarms` (shell api 9) says `{allowed, canAsk}`, and
  `allowExactAlarms` opens Android's page for it (`ACTION_REQUEST_SCHEDULE_EXACT_ALARM`), then
  answers with the new state. Allowing it sends `SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`, on
  which `CheckReceiver` sets every alarm again, now exact. Allowed alarms use
  `setExactAndAllowWhileIdle`, which fires during Doze even with battery optimization on.
- **Battery optimization.** `allowBackground` opens `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`,
  which needs no permission. Without it only the background check-in comes late while the phone is
  idle; reminders do not depend on it.
- **Payment links.** The web app comes from whichever server the app is on, so it is told which
  build it runs in: `info().distribution` (shell api 9) is `play` or `foss`, and a web app hides
  the donation and supporter key links and the app's own update notice in the Play build. When the
  signal is missing (a browser, an older shell) it behaves as foss. A server older than this does
  not know to ask, so `ShellWebViewClient` is the backstop: in the Play build it opens no link to,
  and loads nothing (not even in a frame) from, the sites in `PaymentLinks` (every site in `web/src/app/support/links.ts`, and
  `pecklist.com/support`) and quietly does nothing instead. `PaymentLinksTest` reads the web app's
  support code and fails if a link there is not caught, so a new donation platform must be added
  to `PaymentLinks` too.

## Building

You need JDK 21 and the Android SDK (platform 36, build tools 36). Point `ANDROID_HOME` at the SDK.

```bash
pnpm install
pnpm --filter @pecklist/mobile apk
```

That builds the web app, copies it into the Android project (`cap sync`) and builds the foss debug
APK, `mobile/android/app/build/outputs/apk/foss/debug/app-foss-debug.apk`. Install it with
`adb install -r <apk>`. The Play build, for trying on a phone, is `assemblePlayDebug`
(`outputs/apk/play/debug/app-play-debug.apk`). Unit tests for the native code, in both builds:

```bash
cd mobile/android && ./gradlew testFossDebugUnitTest testPlayDebugUnitTest
```

Tests for one build only go in `src/testFoss/` or `src/testPlay/`.

CI builds the foss debug APK in the `android-apk` job (manual on main and merge requests), and the
signed release APK and Play bundle in `android-release` (automatic on release commits, manual on
main).

## Release signing

Android only installs an update signed with the same key as the installed app, so the release key
must never change or be lost. Debug and release builds have different keys: a phone with the debug
build needs it uninstalled before the release one goes on.

| Where | What |
| --- | --- |
| GitLab, project CI/CD variables | `ANDROID_KEYSTORE_BASE64` (the PKCS12 keystore, base64; protected, masked), `ANDROID_KEYSTORE_PASSWORD` (protected, masked), `ANDROID_KEY_ALIAS` (`punchlist`, protected) |
| GitLab, protected tags | `v*`, so tag pipelines get the protected variables (only `main` and `v*` tags can sign) |
| Google Play Console | The same key, as the app's signing key (Play App Signing) |
| A password manager | The keystore file and its password: the copy to restore from |

The key: RSA 4096, alias `punchlist`, `CN=Punchlist, O=killswitch10` (made before the rename, as
are its alias and the keystore's file name, `punchlist-release.p12`; the name in a certificate
can't change without a new key, and every install would have to be removed for that), valid 100
years,
certificate SHA-256 `18:C8:C5:CE:EE:2E:8C:5D:DD:2E:BE:E6:7A:F8:B6:AA:E5:88:0C:65:65:2D:0C:56:81:85:15:88:4F:3B:BD:CA`.
A PKCS12 keystore has one password for the store and the key.

`mobile/android/app/build.gradle` signs every release build, the foss APK and the Play bundle
alike, when `ANDROID_KEYSTORE_FILE` is set, with `ANDROID_KEYSTORE_PASSWORD` and
`ANDROID_KEY_ALIAS` (and `ANDROID_KEY_PASSWORD` if it ever differs). The release job checks that
the bundle's certificate is the APK's.

### Google Play

Google Play signs what it delivers with an app signing key it holds (Play App Signing). PeckList
gives Play the existing release key for that, instead of letting Play make a new one, so the app
Play installs has the same signature as the APK from GitLab: a Play install and a GitLab APK update
each other, and someone can move between them without uninstalling and losing their data. With a
key Play made, they would be two apps that cannot install over each other.

Once, when the app is set up in Play Console:

1. In **Test and release > App integrity > App signing** (Play Console asks for it with the first
   release), choose **Use existing app signing key**, then **Export and upload a key from Java
   keystore**.
2. Download Google's PEPK tool and encryption key from that page, and run the command it shows on
   a computer you trust, with the keystore from the password manager:

   ```bash
   java -jar pepk.jar --keystore=punchlist-release.p12 --alias=punchlist --output=pecklist-play-key.zip \
     --include-cert --rsa-aes-encryption --encryption-key-path=encryption_public_key.pem
   ```

   It asks for the keystore password and writes the key, encrypted for Google only, to the zip.
3. Upload the zip on that page, then delete it.
4. Use the same key as the upload key: register no separate one. A separate upload key would sit in
   the same CI variables as this one, so it would protect nothing, and the release bundle is
   already signed with this key.

Each release then has `pecklist-play-<version>.aab` among its downloads, which is uploaded to Play
Console by hand. Play App Signing checks it is signed with the upload key, re-signs the APKs it
makes from it with the app signing key (the same key), and refuses a version code that is not higher
than every one it has had.

### Version names and codes

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

Both builds of a version have the same code. There is no `rc.999` (the build fails): it would be the
release's own code, and Google Play refuses a code it has had. `version.properties` holds the code
too, for F-Droid, and `pnpm check:version` and the release guard fail when the two disagree. Signed
builds between releases (`android-release` by hand on `main`) share one code until the next
release, since the code ignores the commit: each installs over the other, newer or older, so keep
them for trying a build, never for anyone's phone, and never upload one to Play. The debug APKs set
`PECKLIST_VERSION_CODE` to the pipeline number instead, so each installs over the one before. A
signed build by hand:

```bash
export ANDROID_KEYSTORE_FILE=/path/to/punchlist-release.p12 ANDROID_KEYSTORE_PASSWORD=...
pnpm --filter @pecklist/mobile exec node scripts/gradle.mjs assembleFossRelease bundlePlayRelease
apksigner verify --print-certs mobile/android/app/build/outputs/apk/foss/release/app-foss-release.apk
keytool -printcert -jarfile mobile/android/app/build/outputs/bundle/playRelease/app-play-release.aab
```

A new key (only if the old one is lost, and every install must then be removed first; Play would
need its key upgraded through Play Console, and `ANDROID_KEY_ALIAS` becomes `pecklist`):

```bash
keytool -genkeypair -keystore pecklist-release.p12 -storetype PKCS12 -alias pecklist \
  -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=PeckList, O=killswitch10"
base64 -w0 pecklist-release.p12   # the value of ANDROID_KEYSTORE_BASE64
```

## F-Droid

F-Droid builds each release tag from source and ships our own signed APK when its build matches
ours byte for byte apart from the signature (a reproducible build). Its recipe builds the foss
flavor (`gradle: [foss]`) and sets nothing else but the revision, so what a release APK holds must
come from the tagged files alone:

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
