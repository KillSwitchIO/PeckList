# Tour

## The sidebar

| View                                    | Shows                                                            |
| --------------------------------------- | ---------------------------------------------------------------- |
| **Today**                               | Tasks that start today or earlier and are still open.            |
| **Upcoming**                            | A week strip, then every coming day, each with its own add.      |
| **Due dates**                           | Tasks with a deadline, by when; select many to move their dates. |
| **Mess Drawer**                         | Tasks not yet put in a list: the place quick ideas land.         |
| **All**                                 | Every open task.                                                 |
| **Calendar**                            | Month, and 1 to 14 days on a time grid.                          |
| **Assigned to me** / **Shared with me** | Tasks others gave you, and lists shared with you.                |
| **Closed**                              | Done and won't-do tasks.                                         |
| **Trash**                               | Deleted tasks and lists, restorable for 30 days.                 |
| **Lists**, **Tags**, **Filters**        | Your own lists, nested tags, and saved filters.                  |

**Edit sidebar** pins and hides views. The menu button at the top left folds the sidebar away
and back (each device remembers it). At the bottom, a small month shows a dot on days with open
tasks; click a day to open that day's tasks as a list, like Today but for any day (today itself
opens Today). The day page adds new tasks to that day, shows what got done that day, and its arrows
step a day. The arrow at the top right of the small month folds it down to just one week (and
back), and each device remembers which. Its title picks a month, and clicked again a year, to jump
far; the dot between its arrows goes back to now. Under it is the app's version, which links to what
changed. On a phone the main views sit in the bottom bar, and **More** holds the rest of the
sidebar: the views, saved filters, lists and tags. Its pencil (or holding a row) edits it just
like **Edit sidebar** on a computer, and the changes apply on every device. While editing, the
**Bottom bar** section at the top picks the bar's tabs: up to four views, saved filters or Search,
dragged into order, with More always last.

Dates leave the year off when it is this year: "Thu, Oct 22", "October", but "Jan 4, 2027".

### Upcoming and Due dates

**Upcoming** lists today and every day after it, empty days included, under a strip of the week's
days. More days load as you near the end, and the strip follows the day at the top of the list.
Swipe the strip sideways (or drag it with the mouse, or use the arrows) to move a week, and the list
goes to the same weekday there; tap a day to jump to it. Going back before today, or picking an earlier day from the
month name above the strip, starts the list on that day; **Today** brings it back, and Upcoming
always opens on today. Each day's **+** adds a task to that day. Overdue tasks sit on top while
the list starts today. Grouping it any other way than by date shows the next 7 days' tasks in those
groups instead.

**Due dates** shows every open task with a due date: Overdue, Due today, Due tomorrow, Due in the
next 7 days and Due later. Each row shows its due date (even when the task also has a start) and
changes it in place. **Select** (or hold a row on a phone), pick tasks or a whole group with
**Select all**, then move them all to **Today**, **Tomorrow**, **Next week** or a date you pick, or
clear them. Each task keeps its own time of day, and **Undo** puts them back.

**Filter** (the funnel at the top of Today, Upcoming and the Calendar) shows only some lists, tags
and saved filters, in any mix: a task shows when it is in one of the lists picked, has one of the
tags picked (or a tag under one) and matches one of the saved filters picked; a kind with nothing
picked lets everything through. Each of the three keeps its own filter on this device, and the
funnel is colored while one is on. **Clear** shows everything again.

## Tasks

A task has a title, notes (rich text, with `- [ ] ` checklists), subtasks, tags, a priority, a
**start** (a date, a time, or a time span) and an optional hard **due** date. Views place tasks by
their start; the due date is the deadline.

- **Add**: the field at the top of a list, or press ++q++ anywhere. Type it all in one line:
  see [quick add](quick-add-and-shortcuts.md).
- **Open**: click a task for its details panel; it can be widened or made full screen. The
  expand button at the end of the add field opens a new task straight in the full view, filled
  with what you typed. At the bottom: when the task was made and last changed. On a phone,
  comments and those dates wait behind a bar at the bottom that slides a panel up. Panels that slide up close with a swipe down or a tap outside them. Phone rows put
  the title on its own line, with the list and tags under it and the date at the right.
- **Reminders**: in a task's details, **Reminders** opens a list like TickTick's: tick any of
  **On time**, 5 or 30 minutes, an hour or a day early (an all-day task: **On the day**, 1, 2 or 3
  days or a week early, each at 9:00 or the time set in **Settings > New tasks > All-day reminder
  time**), or **None**. **Custom** makes your own: for an all-day task, the **Day** or **Week** tab
  picks how early and the wheels the time of day; for a timed task, the **Minute**, **Hour** or **Day** tab picks how early. It shows
  when the reminder will come, or that the time has passed. **Constant reminder** keeps a reminder
  on screen and brings it back every 5 minutes for an hour, until the task is done; its
  **Dismiss** stops that reminder (the task's other reminders still come) and **Snooze 10 min**
  adds a one-time reminder ten minutes on. Nothing
  changes until **OK**. The first reminder asks your browser for permission to show notifications.
  Reminders go to the people the task is assigned to, or to whoever made it when nobody is.
  They appear while Punchlist is open or in the background (offline too), and with a server and
  **Settings > Notifications > Notify me when Punchlist is closed** turned on for the device, also
  with Punchlist closed (on iPhone and iPad, from Punchlist added to the Home Screen). A click
  opens the task. A small bell on the row shows a task has reminders. **Settings > New tasks** can
  give new tasks a reminder.
- **Repeat**: in a task's details, **Repeat** offers daily, weekly on the task's weekday, weekdays,
  monthly on its day and yearly on its date, and **Custom**: every so many days, weeks (on the
  days you pick), months (on its day, on its weekday such as the second Tuesday, or on the last
  day) or years, ending never, on a date or after a number of times, and counted from the task's
  date or from when you finish it. Completing a repeating task, or marking it won't do, keeps a
  closed copy in its history and moves the task to its next date, keeping its time and reopening
  its subtasks. A task without a date starts today. A small arrows icon on the row shows it repeats.
  Quick add reads `every ...` too.
- **Notes**: always ready to type in, with no edit mode. Checklist boxes tick with one tap, without
  starting to edit. The small button in their bottom right opens the full editor, with a
  formatting toolbar.
- **Assigned**: a task you add to a shared list starts assigned to you.
- **Files**: the paperclip at the top of a task's details attaches files, or drop them on the
  details. Pictures show as thumbnails and open large; other files download. Everyone who sees the
  task sees its files; whoever added one, or the list's owner, removes it. Files sync through the
  server (up to `ATTACHMENT_MAX_MB`, 25 MB by default); a larger one is refused before it is added.
- **Complete**: the circle on the left, or ++space++. **Won't do** is in the task's menu.
- **Move**: drag it up or down (on a phone, hold it a moment first); the task rides along under
  your finger, and near the top or bottom of the screen the page scrolls on. In a list's own order a
  line shows where it will land: drag it right to make it a subtask, left to undo that, or drop it
  on the middle of another task to nest it there; a list sorted another way switches to its own
  order when you drop. Into another group, the whole group lights up and the task takes its value:
  a day (Today, Tomorrow, a day in Upcoming) or **No date** sets its date (keeping its time),
  **Next 7 days** and **Later** date it to their first day, priority, tag and list groups set its
  priority, swap its tag or move it to that list, and **Pinned** pins it (dragging a task out of
  Pinned unpins it). Overdue only drags out: letting go over it, or over the task's own group,
  changes nothing. Drop it on a list in the sidebar to move it there. Or use **Move to list...** in
  its menu, or ++alt+arrow-up++ / ++alt+arrow-down++ / ++alt+arrow-right++ / ++alt+arrow-left++.
- **Groups**: a group's whole heading row (apart from its buttons) folds and unfolds it.
- **Pin**: **Pin to the top** in a task's menu (or the pin in its details) keeps it in a **Pinned**
  group at the top of every view it shows in. Completing it lets go of the pin.
- **Swipe** (phones and tablets, like TickTick): swipe a task right to complete it (or reopen a
  closed one); a short swipe left shows **Date**, **Move** and **Delete**, and a full one opens
  the task's date. **Settings > Swipe actions** shows each side on a sample task and changes its
  buttons (up to three: Complete, Date, Move, Pin, Won't do or Delete; move them left
  or right, take one away, add another) and what a full swipe does, or turns the full swipe off;
  it is kept per device. Each change can be undone. Swiping up and down still scrolls. Holding a
  task drags it; holding its checkbox opens its menu.
- **Undo**: every change shows a small round **Undo** button for a few seconds (a ring runs
  down the time; it sits bottom left on a phone, bottom right on a big screen). Swipe it left or
  right to send it away.
- **Comment**: at the bottom of a task's details. Comments take a little Markdown (`**bold**`,
  `*italic*`, `` `code` ``, `[links](https://...)`) and **@name** for the people on the task (type
  `@` for suggestions). ++ctrl+enter++ posts. Everyone who sees the task sees its comments; people
  who may change the task may comment (a list's viewers only read). You edit or delete your own;
  a list's owner may delete any on it.

## Lists

Lists hold tasks. The three dots next to a list's name open its view menu: **Select**, the view
(**List** or **Timeline**), grouping (by date, priority or tag, or **None** for the list's own
order, the one you drag tasks in) and sorting, and, for its owner, editing, archiving or deleting
the list. The built-in views (Today, Upcoming, All, Assigned to me, Shared with me) and every tag
and saved filter have the same menu, plus **List** to group by list. Picking the chosen grouping or
sort again turns it around (an arrow shows which way it runs): Z to A, latest date first (undated
tasks stay last), low priority first, oldest first, or the groups in reverse. Each list and view
keeps its own choice on this device, and the dots turn colored while it differs from the default;
**Restore defaults** at the bottom of the menu goes back.

**Select** picks many tasks at once: each task's box becomes a circle to tap, and each group gets
a circle that picks everything in it. The bar at the bottom (in place of the tabs on a phone) then
completes, dates, moves, tags, prioritizes, pins or deletes them all together; one **Undo** puts
them back, and the cross stops selecting.

**Timeline** shows a list's dated tasks as bars across their days, with today marked. Drag a bar
to move the task to other days (its times and length stay), or drag either end to change when it
starts or ends; a click opens it. **One per task** gives each task its own row; **Fit together**
lets tasks that do not overlap share a row, to see more at once. The magnifiers make days wider or
narrower. Tasks without a date wait under the timeline. Each list remembers whether it was last
shown as a List or a Timeline, on this device.

Folding a group (click its heading) folds it everywhere it shows: fold **Overdue** in Today and it
is folded in Upcoming, All and your lists too, until you open it again. Each device remembers.

A list is marked in the sidebar by its color as a dot until you give it an icon: **Edit list**
(or the new-list dialog) offers line icons drawn in the list's color, common emoji, or any emoji
typed in. Colors for lists and tags open on your theme's own nine, with the families (Pastel,
Muted, Earthy, Classic, Vivid) beside them, **More themes** for any other theme's set, and the
rainbow circle for a custom color. A list shared with a group shows the group after its name
("Groceries - Household") for everyone, so it never looks like someone's own list of the same name.
Lists can be shared: see [sharing](sharing.md).

Lists used to have sections. They are gone: a list that had them keeps its tasks in the order they
showed in (tasks outside a section first), and the section names go.

## Tags

Tags nest with `/`: `home/garden`. A task tagged `home/garden` also shows under `home`. Pick colors
in a tag's menu; subtasks inherit their parent's tags.

## Calendar

Two views, switched at the top right:

- **Month**: the weeks run on without breaks, scrolling a week at a time, so the next weeks are
  always in sight at the end of a month. Each day lists its tasks as short lines (time first for
  timed ones, an hourglass for a due date), then **+N more**. Pick 4, 5 or 6 weeks on screen
  with the round number button.
  Click a day (or its **+N more**) for everything on it and a field to add to it. Drag across
  several days, or swipe across them on a phone, to **Show these days** or make a **New task over
  these days**.
- **Days**: 1 to 14 days side by side on a time grid, with an all-day row on top. The round
  number button by the view switch picks how many: press and hold it, run your finger round the
  dial that opens (the number under it rings and grows, and the days follow as you go), and let
  go to keep it. A tap opens the dial to tap a number; with the keyboard, the arrow keys step it. Pinch, or hold Ctrl and use the wheel, to make hours taller or
  shorter. Click an empty time to add a task there. On a phone, swipe sideways to page.

Drag a task to move it to another day or time, by finger or mouse; the calendar scrolls by its
dates and empty space. In Days, pull the grip at a task's top or bottom edge to change when it
starts or ends; on a phone, hold a task still for a moment to get big grips above and below it
(easy to hit on a short task), and tap elsewhere when done. While you drag or stretch a task,
a label above it shows its start (and end) time, and a dashed outline shows where it will land.
Phones show no scrollbars in the calendar: swipe to scroll. Drag tasks from **Unscheduled** onto a day (all day) or a
time. A task dropped on a month day keeps its time. The list button at the top opens Upcoming,
the agenda. Each device remembers the view, days, weeks and hour height.

## Your profile menu

Your profile picture in the top right (your photo or initials, with a small icon of the sign-in
provider when you signed in through one) opens a menu with **Notifications**,
**Settings**, **Admin** (admins only), **Stats** (your own numbers, as the server counts them),
**Friends and groups**, **Keyboard shortcuts**, **Change password** and **Log out**.

**Settings > Profile** holds your photo: choose a picture, then drag it (or use the arrow keys) and pinch, scroll or use
the slider to zoom until it sits in the circle, and **Save**. It is kept small on your profile, so
friends and people you share with see it too. **Remove photo** goes back to your initials.
Signed in through an identity provider with no photo of your own (never set, or removed): at
sign-in Punchlist uses the provider's picture, if it gives one. A photo you set stays yours.

**Change password** asks for the new password twice. Every password field has an eye at its right
end that shows what you typed.

**Notifications** lists reminders, @mentions, tasks someone assigned you and lists someone shared
with you, newest first; a red dot on your picture means some are new. A click opens the task or
list, the cross clears one and **Clear all** clears the rest. Opening the page marks them read.
The server keeps them for 90 days; reminders that fired on this device stay on it.

## Settings

**Settings** (the profile menu, or ++g++ ++s++): appearance (light, dark or system theme, and
colors), dates (your time zone, how dates show, 12 or 24-hour clock, the first day of the week,
when a due date counts as soon, how long a task with only a start time shows on the calendar), sign-in methods and
linked accounts, and **Your data** ([download or import a copy](apps-and-sync.md#your-data-as-a-file), or
[move from or to another app](apps-and-sync.md#moving-from-or-to-another-app): TickTick, Todoist, Google Tasks,
Microsoft To Do, iCalendar and Things).

**Start over** (last on the page): **Delete all lists, tasks and tags** moves every list, task and tag
of yours to the Trash at once (lists others share with you stay), and Undo brings them back. Tick
**Also empty the Trash** to delete them, and everything already in the Trash, for good.

**Date format**: the language's own (Automatic), a ready-made one such as `2026-10-24` or
`24.10.2026`, or **Custom...** to type a pattern such as `YYYYMMDD` or `ddd D MMM`: `YYYY` 2026,
`YY` 26, `MMMM` October, `MMM` Oct, `MM` 10, `M` 10, `DD` 05, `D` 5, `dddd` Monday, `ddd` Mon,
and `[text]` as is. It shows today's date in the pattern as you type. Today, Tomorrow and
Yesterday keep their names.

**Colors**: pick one of 16 palettes, from calm (Punchlist, Ocean, Forest, Graphite) and soft (Rose,
Blossom, Peach, Lavender, Mint) to bright (Electric, Tropical, Citrus, Berry) and deep (Sunset,
Midnight, Coffee), then change any of its colors. **Reset colors** goes back to the palette's own colors. Picking
another palette asks whether to recolor your lists and tags too: each moves to the same spot in
the new palette's set (grays, and lists you cannot change, stay as they are).

**Time zone**: "today", due dates and the calendar follow it. It starts out as the server's time
zone (`TZ`), or your device's without a server; pick another one if you live somewhere else.

**New tasks**: what a new task starts with: a list (for tasks added outside a list), a priority, a
date (none, today, tomorrow or in a week) with an optional time, and on a server whether tasks you
add to shared lists start assigned to you. Where you add a task still wins: in a list it goes to
that list, in Today or on a day it gets that date, and what you type in quick add wins over both.
