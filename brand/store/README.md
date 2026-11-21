# Store and site assets (draft)

Drafts for the Google Play listing and the website, for Ben to pick from. Nothing here is
published, and `fastlane/metadata` (what F-Droid and Play read today) is unchanged.

## What is here

| Path                    | What                                                                                                                                                | Size                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `short-description.txt` | Play's short description                                                                                                                            | 68 characters (limit 80)             |
| `full-description.txt`  | Play's full description, with the tags Play and F-Droid accept (`<b>`, `<ul>`, `<li>`)                                                              | about 2,600 characters (limit 4,000) |
| `feature-graphic.png`   | Play's feature graphic: the 46c bird heading its list on PeckList Forest, with the name                                                             | 1024 x 500                           |
| `feature-graphic.svg`   | Its source. The text uses the system font (Segoe UI where it was drawn), so render it again on the same system, or swap the text for outlines first |                                      |
| `screenshots/phone/`    | The Android app on a phone: Today, a shared list, a task with subtasks, groceries with who buys what, Upcoming, and Today in dark                   | 1080 x 2160, 6                       |
| `screenshots/tablet/`   | The Android app on a tablet, landscape: Today, a shared list with a task open, the calendar                                                         | 2560 x 1600, 3                       |
| `screenshots/desktop/`  | The web app in a desktop browser: Today, a shared list with a task open, the calendar, and Today in dark                                            | 2880 x 1800, 4                       |

## The listing in other languages (machine drafts)

`drafts/de-DE/`, `drafts/es-ES/` and `drafts/fr-FR/` hold the short and full descriptions in German,
Spanish and French. They are **machine-drafted from the English above and not checked by a person
yet**. They use the words the app's own German, Spanish and French use (du, tú, vous; Heute,
Demnächst; Hoy, Próximas; Aujourd'hui, À venir).

| Language | Short description        | Full description |
| -------- | ------------------------ | ---------------- |
| German   | 72 characters (limit 80) | 3,141 characters |
| Spanish  | 69 characters            | 2,967 characters |
| French   | 75 characters            | 3,257 characters |

The file names are F-Droid's (fastlane's): once Ben approves the wording, each folder goes to
`fastlane/metadata/android/<language>/` as it is, and the English files above replace
`fastlane/metadata/android/en-US/short_description.txt` and `full_description.txt` (the text
F-Droid shows today is the older one there). Play takes the same text. Until then nothing here is
submitted anywhere. Keep the "not checked by a person" note with the drafts when they move, until
someone who speaks the language has read them.

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

Every screenshot is light PeckList Forest except the ones named `dark`. The phone and tablet sizes
keep the long side no more than twice the short side, as Play asks (Play takes 2 to 8 phone
screenshots). The phone has no calendar shot: the month view is tight at that width.

Before submitting:

- `desktop/02` shows the version (0.13.0) at the foot of the sidebar. Retake it (or crop the
  footer) at 1.0, or it looks out of date on day one.
- In `desktop/02` the open task "Plan the garage sale" is due Jan 14, 2027, while its comment says
  "I moved this to next week". Harmless, but a retake with the date a week out reads better.

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
