# The Android app

The Android app is PeckList in a native shell: the same app as in the browser, plus reminders
that arrive on time with the app closed, buttons on the notifications, a background check-in with
your server, and sign-in through your real browser. It needs Android 7.0 or later.

You do not have to use it: the [web app installs](apps-and-sync.md#install-the-app) on Android too.
The native app is better at reminders.

## Install

{/* TODO(play-listing): once the Google Play listing is published, add it here as the first way in. */}

Two ways in from the GitLab releases, both with the same signed app:

<Tabs>
<TabItem value="obtainium-updates-itself" label="Obtainium (updates itself)">

[Obtainium](https://github.com/ImranR98/Obtainium) installs apps straight from their release
pages and tells you when there is a new version.

1. Install Obtainium.
2. On the phone, open [this Obtainium link](obtainium://add/https://gitlab.com/killswitch10/pecklist), or in
   Obtainium tap **Add app** and paste:

    ```text
    https://gitlab.com/killswitch10/pecklist
    ```

3. Obtainium finds the GitLab releases. If it asks which file to install, pick
   `pecklist-android-<version>.apk` (to make it ask no more, set **Filter APKs by regular expression**
   to `pecklist-android.*\.apk`). If you set the older filter, `pecklist-android\.apk`, change it to this.
4. **Install**, and allow Obtainium to install apps when Android asks.

</TabItem>
<TabItem value="download-the-apk" label="Download the APK">

1. Open the [latest release](https://gitlab.com/killswitch10/pecklist/-/releases) on the phone.
2. Download `pecklist-android-<version>.apk`.
3. Open it and allow your browser to install apps when Android asks.

To check the download, compare its SHA-256 with its line in the
release's `SHA256SUMS`, which is itself signed ([verifying downloads](../install/verifying.md)). For updates, download the next release's APK and install it over the
old one; your data stays.

</TabItem>
</Tabs>

Every release APK is signed with the same key, so each one installs over the last. The Google Play
build is the same app, with the same app ID and the same key, so it installs over a GitLab APK and
the other way round, and your data stays. A build you made yourself, or a debug build, has a
different key: uninstall it first.

:::note[Moving to the new app ID]

Releases after 0.11.0 have a new Android app ID, `com.pecklist.app` (it was
`com.killswitch10.pecklist`). Android treats it as a different app, so the new one installs
beside the old one instead of updating it. Until you uninstall the old one, both show as PeckList
in the launcher; long-press an icon and open **App info** to see which ID it has. Install the new
release, connect it to your server and sign in, then uninstall the old PeckList app; your tasks are on the server, so nothing is lost. If
the old app holds changes made offline, open it with a connection first, so they sync. Servers keep
accepting sign-ins from both apps. In Obtainium, remove the old entry if it does not pick up the new
app, and add PeckList again.

:::

:::note[Coming from the Punchlist app]

The app was called Punchlist before the rename (`com.killswitch10.punchlist`); PeckList is a
new app on Android (`com.killswitch10.pecklist`), so it installs beside the old one instead of
over it. Install PeckList, connect it to your server and sign in, then uninstall Punchlist.
Your tasks are on the server, so nothing is lost. The Punchlist app does not connect to a
PeckList 0.7.0 server or newer: if it holds changes made offline, open it with a connection
before the server is upgraded, so they sync. In Obtainium, add PeckList as a new app the same
way and remove the Punchlist entry.

:::

## First start

The app asks where your server is, or runs on the phone alone:

- **Connect**: type the address (`tasks.example.com`, or `192.168.1.20:8080` at home). The app
  checks that a PeckList server answers there, then runs that server's own copy of the app, so
  the app and the server never disagree about versions. An address without `https://` is tried
  with HTTPS first, then plain HTTP, which it warns about before using. If the address sends the
  app on to another one, the app shows where before going there.
- **Use on this device only**: no account and no sync, like the web app without a server. If you
  connect to a server later, the tasks you made go along: after you sign in, the app asks
  whether to **Add them to my account** or **Leave them on the phone** (they stay there either
  way, for whenever you use the app without a server again).

**Settings > Account > Server** shows where the app is connected; **Change** or **Disconnect** moves
it. Either asks in the app's own dialog first (**Switch servers?**, **Use PeckList without a
server?**), which a web page cannot answer, so a server that was taken over cannot move the app
to a lookalike. Disconnecting leaves your tasks on the server. If a server will not let you in at all, long-press
the PeckList icon on the home screen, pick **Change server**, and confirm.

## Signing in through your browser

With a username and password, you sign in inside the app as usual. With a provider (the
**Continue with ...** buttons, single sign-on), the app opens the provider in a browser tab
instead:

1. Tap **Continue with ...**. A browser tab opens on your server.
2. Sign in to the provider there, if the browser is not signed in already. Passkeys, saved
   passwords and your password manager all work, because this is your real browser.
3. PeckList asks **Open PeckList on this device?** and names the account. Tap **Continue**.
4. The tab closes and the app is signed in.

Why the detour: passkeys do not work inside an app's own web view, and some providers refuse to
sign in there at all. So the browser does the signing in, and then hands the app a one-time code.
The code lasts two minutes, and only the app that started the sign-in can use it, because it must
be sent back with a secret the app made and never left the phone.

The **Continue** page is the safety catch. Any app on the phone can open a browser tab, so without
it another app could quietly get a session for whoever is signed in to that browser. **If you see
"Open PeckList on this device?" without having just tapped a sign-in button in the app, close the
tab.**

The app's session is a copy of the browser's, so it ends when your server's provider session
setting says (`OIDC_<NAME>_SESSION_HOURS`, 12 hours by default).

**Passkeys** go the same way: **Sign in with a passkey** opens the server's sign-in page in a
browser tab, where your phone (or your password manager) offers the passkey, and the tab hands you
back to the app as above. **Add a passkey** under **Settings > Account > Passkeys** opens a page in a browser
tab that makes one for your account and comes back to the app; the tab needs no sign-in of its
own.

### Servers behind their own sign-in page

If your server sits behind a gate such as Cloudflare Access, Authelia or Authentik's proxy, the app
asks you to get past it first. **Sign in** does that in your browser too, then hands the pass back
to the app after you confirm, the same way as above. **Sign in here instead** works for gates
without passkeys.

**Pangolin** keeps its sign-in to itself, so the hand-back cannot work there. Make a share link for
the resource in Pangolin (no expiry, or as long as you like), paste it into the app's sign-in card
under **Behind Pangolin?**, and the app is let in as a browser would be, for as long as the link's
session lasts.

Servers with a certificate from your own CA work once that CA is installed on the phone
(Settings > Security > Encryption & credentials > Install a certificate). The connect page then
says the certificate comes from an authority installed on the phone; tap **Trust it**. The app
trusts installed authorities only for servers you said yes to: if a server you use starts
answering with a certificate from one you did not (someone reading the traffic on the way, say),
the app stops and asks at its next start, and the background check-in pauses until then. Plain
HTTP is the same: the yes you gave on the connect page is for that server only.

## Reminders and notifications

- Reminders arrive as Android notifications on time, even with the app closed, with **Complete**
  and **Snooze** buttons that never open the app. Snooze asks how long. A repeating task moves on
  to its next date. Without a server, the app catches up on the presses the next time you open
  it.
- With the app closed it checks in with your server every 5 minutes: new shares, assignments and
  mentions show as notifications, and reminders set on another device are set on the phone too.
  **Settings > Notifications** turns the check-in off or makes it less frequent (15, 30 or 60
  minutes).
- Each kind of notification has its own category in the phone's notification settings for
  PeckList, with its own sound, vibration and on or off switch, from the first start: **Reminders**
  and **Constant reminders** under Reminders, and **Assignments and dibs**, **Shared lists** and
  **Comments and mentions** under From other people. Recent Android versions fold categories that
  have not sent anything yet under **Show unused categories**.
- **Settings > Notifications** in the app follows the phone. Each switch there opens its category
  in the phone's settings, and turning a kind off or on there turns it off or on in the app too,
  for all your devices, once you come back to the app. **Manage on the phone** opens the whole
  list.
- A constant reminder keeps buzzing until you open it, dismiss it or press a button, and goes
  quiet after 30 minutes. It makes no sound unless you give **Constant reminders** one there.
- After you sign in, the app asks to send notifications and to run in the background. Allow both,
  or reminders and check-ins come late or not at all. When the app was opened to add a task (the
  Add task shortcut, a widget, voice or shared text), it asks the next time instead, so the
  keyboard stays up.
- On a Samsung phone, also add PeckList to **Never sleeping apps** (Settings > Battery >
  Background usage limits). Other brands have similar battery savers; see
  [dontkillmyapp.com](https://dontkillmyapp.com/) for yours.

## The Google Play build

The Google Play build follows Google Play's rules, so a few things differ from the GitLab APK:

- **No donation links.** It shows no links to donate or to buy a supporter key. A key you already
  have still goes in under **Settings > Support PeckList**.
- **Battery optimization, by hand.** A Play app may not ask to be left out of Android's battery
  optimization, so **Allow** under **Settings > Notifications** opens the phone's list of apps
  instead: pick PeckList there and choose not to optimize it. Reminders don't depend on it;
  without it, only the background check-in can come late while the phone is idle.
- **Exact reminders need a one-time allow.** On Android 14 and later, a Play app may only set
  alarms for an exact time once you allow it. Until then the app shows **Allow exact reminders**,
  which opens the page to allow it; without it, Android may hold reminders back a while.
- **No update notice.** Google Play updates the app, so it shows no **Update available** box.

## Updates

When a newer release is out than your app, a box at the bottom of the sidebar (at the end of
**More** on a phone) says so, with **Release page** for its notes and the APK. Your server finds
out through its [update check](privacy.md#the-update-check); Obtainium also tells you on its own. Most changes need no app update at
all, since the app runs your server's copy of PeckList. When one does, the release notes say so
under **Compatibility**, and an app that is too old for the server is signed out until it updates.

## Everyday use

- Long-press the PeckList icon for **Add task** (Today, with the add field ready to type in),
  **Today**, **Change server**, **Add by voice** and **Search**, and the list you opened last.
  Launchers show four, and the list takes the place of the last ones. Drag any of them to the home
  screen to keep it there.
- Add a task without opening the app first. Each of these opens Today with the words in the add
  field, so you can check them, and dates and times in them work as when you type. Press Enter to
  add it:
  - **By voice**: the **Add by voice** shortcut, the microphone on the **Add task bar** widget, or
    the **Add task** tile in Quick Settings (edit your tiles to put it there). It uses your phone's
    own speech recognition. With none, the add field opens with the keyboard, which may have its
    own microphone.
  - **From another app**: share text to PeckList, or select text and pick **Add to PeckList**.
  - **From an automation app** (Tasker, Automate and the like): send the intent
    `com.pecklist.app.ADD_TEXT` to the package `com.pecklist.app` with the text in
    `android.intent.extra.TEXT`.

  Nothing is added until you press Enter, so another app can only fill in the field.
- Pull down at the top of a list to sync now.
- Add widgets from your home screen's widget picker (long-press an empty spot, then
  **Widgets**, then PeckList):
  - **Today** lists today's tasks, overdue first. Tap a circle to complete a task, with a few
    seconds to **Undo**; tap a task to open it, or **+** to add one. It is resizable.
  - **Add task**, a round button, and **Add task bar**, a wide one, open Today with the add field
    ready to type in.
  - **Today's count** shows how many tasks are left for today, in red while any are overdue.

  They follow your phone's colors and its light or dark mode on Android 12 and later. They move to
  the next day at midnight on their own, and show what the app last saw: open the app to bring
  them up to date after a change on another device. A task completed on a widget while offline
  goes to the server once the phone is back online, as a reminder's **Complete** does. If the
  server turns it down (in a list you can only view, say), the task shows again. After signing
  out or changing server they ask you to open PeckList. Task titles show on the home screen, so
  think twice before adding **Today** to a phone others use.
- Back steps back through the app; on the first screen, press it twice to leave.
- Everything else works as in the browser: [the tour](index.md).
