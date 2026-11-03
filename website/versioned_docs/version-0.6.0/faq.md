# FAQ

**Is there a mobile app?**
PeckList is an installable web app (PWA). On Android, Chrome offers "Install app"; on iPhone and
iPad, Safari's Share > **Add to Home Screen**. It then opens full screen, works offline and syncs.
There are no store apps yet.

**Can I use it without a server?**
Yes. Opened without a PeckList server behind it, the web app keeps everything in the browser, on
that one device. With a server, it syncs between devices and people.

**How many people can one server handle?**
A small machine (a Raspberry Pi 4, a 1 GB VPS) is plenty for a household or a small team on
SQLite. For many more people, PostgreSQL on its own host is the usual next step.

**Does it work offline?**
Every device keeps a full copy of what its person can see and works without a connection. Changes
merge when it reconnects, field by field, so two people editing different parts of a task never
conflict.

**Can I import from TickTick, Todoist or others?**
Yes: TickTick, Todoist, Google Tasks, Microsoft To Do and iCalendar files, under **Settings > Your
data > Import from another app**. See [moving from TickTick or Todoist](using/moving-from-ticktick-or-todoist.md).

**Is there a public API?**
The web app's own HTTP API is usable, but it is not a stable, versioned public API yet. See
[HTTP API](reference/http-api.md).

**Where is my data?**
In the database (`/data/pecklist.db` in the image, `punchlist.db` on servers from before the rename), its snapshots in `/data/snapshots`, attached
files in `/files`, and on
each device's browser storage. Task content is never sent anywhere else. On its own, the server
only checks GitLab for new releases and sends an anonymous daily usage report; both can be turned
off ([privacy](using/privacy.md)). Other outside services are only those you configure, such as
single sign-on or log shipping.

**Which license is it under?**
The [GNU AGPL-3.0-or-later](https://gitlab.com/killswitch10/pecklist/-/blob/main/LICENSE): free
to use, host, change and share, for personal or commercial use. If you change it and run it for
other people over a network, offer them the modified source. Organizations that cannot work under
the AGPL can buy a
[commercial license](https://gitlab.com/killswitch10/pecklist/-/blob/main/COMMERCIAL-LICENSE.md).
