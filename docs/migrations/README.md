# Schema migrations

One file per schema version, `<N>.md`, describing what changed from N-1 and how the migration transforms data.

- Version 1: initial schema.
- Version 21: `entities.templates` (saved tasks and lists to make again: a name, a `kind` of `task` or `list`, an order key, a `body` with the task or list it makes and its dates as days from the day it's used, and how many times it was used; PL-140). Personal, like saved filters. The migration adds an empty collection.
- Version 20: `settings.language` (the language the app speaks, a BCP 47 tag such as `de` or `pt-BR`; PL-148). Optional, absent or null means automatic (the browser's or phone's language), so documents change only in version.
- Version 19: `settings.compactViews` (the views whose task rows show compact, one line each; view ids such as `view:today`). Optional, absent means none, so documents change only in version.
- Version 18: `settings.purgeAfterDays` (how long deleted, completed and won't-do tasks stay: 7, 15 or 30 days, or 2 to 12 months). Optional, absent means 30 days, so documents change only in version.
- Version 17: `settings.notifications` (which kinds of notification reach the person, and whether they vibrate; PL-115). Optional, every switch absent means on, so documents change only in version.
