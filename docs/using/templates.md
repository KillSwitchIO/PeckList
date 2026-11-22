# Templates

A template is a task, or a whole list, saved to make again: a packing list, a weekly review, the
steps for a new starter. A template is a shape, not a task. It never shows in your views, counts,
search or reminders until you use it. The [tour](index.md#templates) has the short version.

Templates are yours alone: they sync to your devices, but aren't shared with the people on your
lists. They go into the full export (**Settings > Your data**) and the server's backups, and come
back with an import or a restore.

## Saving a template

- **A task**: **Save as template** in the task's menu. It keeps the title, notes, priority, tags,
  dates, reminders, how it repeats, and its open subtasks in their order. Done subtasks are left out
  (they are history, not part of the routine), and so are the people on it, files and comments.
- **A list**: **Save as template** in the list's menu. It keeps the list's name, color and icon,
  and its open tasks with their subtasks. Sections are not kept: the tasks come back in one run.
- **From scratch**: **New template** on the Templates page starts an empty one in the editor.

Give it a name and it is ready to use.

## Relative dates

Dates in a template are kept as days from the day you use it, not as calendar dates. Save a task
that starts today and is due in three days, and every task made from it starts on the day you use
the template and is due three days later. Times of day stay as they were.

A task saved while it is overdue does not make overdue tasks: its dates move forward together, so
the earliest lands on the day you use the template and the rest keep their distance from it.

In the editor, each date reads as **Days from use** (0 is the day you use it, 1 the day after) with
an optional time.

## Using a template

- **Quick add**: once you have a task template, an add field shows a template button beside the
  expand button. Pick one (the ones you use most come first, and you can search). Any words you
  typed before picking become the new task's title; with none, it takes the template's title. The
  task lands where the field adds, and opens full screen so you can finish it.
- **An add field for a day** (a day in Upcoming, the Day view, the calendar's day popup): the
  template's dates count from that day, and a template with no dates goes on it.
- **A new list**: **From template** in the new list dialog fills in the name, color and icon, which
  you can change, and **Create** makes a new private list with the template's tasks.
- **The Templates page**: **Use** on a row. A list template asks for the new list's name first.

**Undo** takes back everything one use made, the task and all its subtasks, or the list and all its
tasks, and closes the task if it is still open. It also brings back a template you deleted.

A tag deleted since the template was saved is skipped rather than made again. New tasks get the
assignees from **Settings > New tasks**; subtasks get none.

## The Templates page

**Templates** in the sidebar (on a phone, under **More**) lists your task templates and list
templates in two groups. Drag the grip to reorder them. Tap one to edit it; its menu renames,
duplicates or deletes it. **New template** starts an empty one.

The editor changes the name and, for a list template, the list's name, color and icon. Each task
has its title, notes, priority, start and due dates, repeat and tags; its reminders can be removed.
Add or delete tasks in a row, and open one to edit it and its subtasks. Changes are saved to the
template only: tasks already made from it stay as they are.

## Limits

A template is a routine, not an archive, so it has limits:

| Limit                 | Value                                  |
| --------------------- | -------------------------------------- |
| Tasks in one template | 200, subtasks included                 |
| Subtask levels        | 5, as for any task                     |
| Size                  | 200 KB, mostly notes                   |
| Template name         | 200 characters                         |

Saving a task or list with more than 200 tasks keeps the first 200, in order. A template that is too
big says so in the editor: shorten some notes or remove tasks.
