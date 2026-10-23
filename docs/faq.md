# FAQ

**Is there a mobile app?**
Punchlist is an installable web app (PWA). On Android, Chrome offers "Install app"; on iPhone and
iPad, Safari's Share > **Add to Home Screen**. It then opens full screen, works offline and syncs.
There are no store apps yet.

**Can I use it without a server?**
Yes. Opened without a Punchlist server behind it, the web app keeps everything in the browser, on
that one device. With a server, it syncs between devices and people.

**How many people can one server handle?**
A small machine (a Raspberry Pi 4, a 1 GB VPS) is plenty for a household or a small team on
SQLite. For many more people, PostgreSQL on its own host is the usual next step.

**Does it work offline?**
Every device keeps a full copy of what its person can see and works without a connection. Changes
merge when it reconnects, field by field, so two people editing different parts of a task never
conflict.

**Can I import from TickTick, Todoist or others?**
Not yet.

**Is there a public API?**
The web app's own HTTP API is usable, but it is not a stable, versioned public API yet. See
[HTTP API](reference/http-api.md).

**Where is my data?**
In the database (`/data/punchlist.db` in the image), its snapshots in `/data/snapshots`, and on
each device's browser storage. Nothing is sent anywhere else: no telemetry, no external services
unless you configure single sign-on or log shipping.

**Which license is it under?**
See the repository's README.
