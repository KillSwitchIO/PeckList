# Schema migrations

One file per schema version, `<N>.md`, describing what changed from N-1 and how the migration transforms data.

- Version 1: initial schema.
- Version 17: `settings.notifications` (which kinds of notification reach the person, and whether they vibrate; PL-115). Optional, every switch absent means on, so documents change only in version.
