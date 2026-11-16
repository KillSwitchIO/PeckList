# Schema migrations

One file per schema version, `<N>.md`, describing what changed from N-1 and how the migration transforms data.

- Version 1: initial schema.
- Version 18: `settings.purgeAfterDays` (how long deleted, completed and won't-do tasks stay: 7, 15 or 30 days, or 2 to 12 months). Optional, absent means 30 days, so documents change only in version.
- Version 17: `settings.notifications` (which kinds of notification reach the person, and whether they vibrate; PL-115). Optional, every switch absent means on, so documents change only in version.
