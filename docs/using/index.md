# Tour

## The sidebar

| View                                    | Shows                                                           |
| --------------------------------------- | --------------------------------------------------------------- |
| **Today**                               | Tasks that start today or earlier and are still open.           |
| **Next 7 days**                         | The coming week, day by day.                                    |
| **Mess Drawer**                         | Tasks not yet put in a list: the place quick ideas land.        |
| **All**                                 | Every open task.                                                |
| **Calendar**                            | Month, week and day.                                            |
| **Assigned to me** / **Shared with me** | Tasks others gave you, and lists shared with you.               |
| **Closed**                              | Done and won't-do tasks.                                        |
| **Trash**                               | Deleted tasks and lists, restorable for 30 days.                |
| **Lists**, **Tags**, **Filters**        | Your own lists (with sections), nested tags, and saved filters. |

**Edit sidebar** pins and hides views. On a phone the main views sit in the bottom bar.

## Tasks

A task has a title, notes (rich text, with `- [ ] ` checklists), subtasks, tags, a priority, a
**start** (a date, a time, or a time span) and an optional hard **due** date. Views place tasks by
their start; the due date is the deadline.

- **Add**: the field at the top of a list, or press ++q++ anywhere. Type it all in one line:
  see [quick add](quick-add-and-shortcuts.md).
- **Open**: click a task for its details panel; it can be widened or made full screen.
- **Complete**: the circle on the left, or ++space++. **Won't do** is in the task's menu.
- **Move**: drag it up or down; drag it right to make it a subtask, left to undo that; drop it on
  the middle of another task to nest it there; drop it on a list in the sidebar to move it. Or use
  **Move to list...** in its menu, or ++alt+arrow-up++ / ++alt+arrow-down++ /
  ++alt+arrow-right++ / ++alt+arrow-left++.
- **Undo**: every change shows an **Undo** button for a few seconds.
- **Comment**: at the bottom of a task's details. Comments take a little Markdown (`**bold**`,
  `*italic*`, `` `code` ``, `[links](https://...)`) and **@name** for the people on the task (type
  `@` for suggestions). ++ctrl+enter++ posts. Everyone who sees the task sees its comments; people
  who may change the task may comment (a list's viewers only read). You edit or delete your own;
  a list's owner may delete any on it.

## Lists and sections

Lists hold tasks; sections split a list into parts (drag a section's header to reorder, or use its
menu). A list's **...** menu groups it by section or by date. Lists can be shared: see
[sharing](sharing.md).

## Tags

Tags nest with `/`: `home/garden`. A task tagged `home/garden` also shows under `home`. Pick colors
in a tag's menu; subtasks inherit their parent's tags.

## Calendar

Month, week and day views. Drag a task from **Unscheduled** onto a day (all day) or, in the week and
day views, onto a time. Drag a scheduled task to move it, pull its bottom edge to make it longer.

## Your profile menu

Your profile picture in the top right (your initials, with a small icon of the sign-in provider
when you signed in through one) opens a menu with **Settings**, **Admin** (admins only), **Stats**
(your own numbers, as the server counts them), **Friends and groups**, **Keyboard shortcuts**,
**Change password** and **Log out**.

## Settings

**Settings** (the profile menu, or ++g++ ++s++): appearance (light, dark or system theme, and
colors), dates (your time zone, 12 or 24-hour clock, the first day of the week, when a due date
counts as soon, how long a task with only a start time shows on the calendar), sign-in methods and
linked accounts, and **Your data** ([download or import a copy](apps-and-sync.md#your-data-as-a-file)).

**Time zone**: "today", due dates and the calendar follow it. It starts out as the server's time
zone (`TZ`), or your device's without a server; pick another one if you live somewhere else.
