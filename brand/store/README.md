# Store and site assets

The store listing lives in `fastlane/metadata/android/`, which F-Droid reads and Play takes the
same text from. This folder keeps what the listing doesn't use: the desktop screenshots for the
website and the feature graphic's source.

## Where everything is

| Path                                                         | What                                                                                                                                                | Size                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `fastlane/metadata/android/en-US/short_description.txt`      | The short description                                                                                                                               | 68 characters (limit 80)             |
| `fastlane/metadata/android/en-US/full_description.txt`       | The full description, with the tags Play and F-Droid accept (`<b>`, `<ul>`, `<li>`)                                                                 | about 2,600 characters (limit 4,000) |
| `fastlane/metadata/android/en-US/images/featureGraphic.png`  | Play's feature graphic: the 46c bird heading its list on PeckList Forest, with the name                                                             | 1024 x 500                           |
| `brand/store/feature-graphic.svg`                            | Its source. The text uses the system font (Segoe UI where it was drawn), so render it again on the same system, or swap the text for outlines first |                                      |
| `fastlane/metadata/android/en-US/images/phoneScreenshots/`   | The Android app on a phone: Today, a shared list, a task with subtasks, groceries with who buys what, Upcoming, and Today in dark                   | 1080 x 2160, 6                       |
| `fastlane/metadata/android/en-US/images/tenInchScreenshots/` | The Android app on a tablet, landscape: Today, a shared list with a task open, the calendar                                                         | 2560 x 1600, 3                       |
| `brand/store/screenshots/desktop/`                           | The web app in a desktop browser, for the website: Today, a shared list with a task open, the calendar, and Today in dark                           | 2880 x 1800, 4                       |

## The listing in other languages (machine translated)

`fastlane/metadata/android/de-DE/`, `es-ES/` and `fr-FR/` hold the short and full descriptions in
German, Spanish and French. They are **machine translated from the English and not checked by a
person yet** (`fastlane/metadata/android/MACHINE_TRANSLATED.md` says so beside them). They use the
words the app's own German, Spanish and French use (du, tú, vous; Heute, Demnächst; Hoy, Próximas;
Aujourd'hui, À venir). Remove a language from that note once someone who speaks it has read it.

| Language | Short description        | Full description |
| -------- | ------------------------ | ---------------- |
| German   | 72 characters (limit 80) | 3,164 characters |
| Spanish  | 69 characters            | 2,985 characters |
| French   | 75 characters            | 3,273 characters |

The other languages have no screenshots of their own, so the stores show the English ones.

## Listing details

What the stores ask for besides the text, as the project's own pages already publish it:

| Field                       | Value                                                       |
| --------------------------- | ----------------------------------------------------------- |
| Privacy policy URL          | <https://docs.pecklist.com/privacy-policy/>                 |
| Account deletion URL (Play) | <https://docs.pecklist.com/delete-account/>                 |
| Support email               | support@pecklist.com (the address the privacy policy gives) |
| Website                     | <https://pecklist.com>                                      |
| App name (`title.txt`)      | PeckList                                                    |

## Screenshots

Every screenshot is light PeckList Forest except the dark ones (phone 6, desktop 04). The phone and
tablet sizes keep the long side no more than twice the short side, as Play asks (Play takes 2 to 8
phone screenshots). The phone has no calendar shot: the month view is tight at that width.

Still to do at 1.0:

- **`desktop/02` needs a retake.** It shows the version (0.13.0) at the foot of the sidebar, which
  looks out of date on day one. While retaking it, put the open task "Plan the garage sale" a week
  out: today it is due Jan 14, 2027, while its comment says "I moved this to next week".

## How they were made

- **Data:** only the demo seed (`web/src/demo/seed.ts`), the same one the public demo server
  loads, imported with `--shift-dates` into a local server built from `main`. Signed in as
  `demo-sam`. No real account, and no address of a real server, appears in any image.
- **Today** uses the **Compact** row size (**View options > Row size**).
- **Tidied in the app first**, as anyone could: **Postpone** moved the seed's overdue tasks (weeks
  old by then) to today, and two pinned tasks were unpinned, since a pinned task also shows in its
  date's group and reads as a duplicate in a still image.
- **Phone and tablet:** the debug build of the Android app from `main` on the Android emulator
  (Android 16), with the system's demo mode for a tidy status bar (9:41, full battery, Wi-Fi).
  The tablet is the same emulator with its screen set to 2560 x 1600 at 320 dpi.
- **Desktop:** the web app in headless Chrome at 1440 x 900, twice the pixel density.
- The demo banner and the sidebar's **Support PeckList** card were hidden first, as any visitor
  can hide them.
