# Moving from TickTick or Todoist

Bring your lists across in a few minutes. The import runs in the app on your device: the export
file is read there and never uploaded as a file; what it finds becomes ordinary tasks, which sync
to your server like any others. Google Tasks, Microsoft To Do and iCalendar files work the same
way ([the other apps](apps-and-sync.md#moving-from-or-to-another-app)).

## 1. Get the export

=== "TickTick"

    TickTick's backup is one `.csv` file with every list.

    1. Sign in at [ticktick.com](https://ticktick.com) in a browser.
    2. **Settings > Account > Backup**, then **Generate backup**.
    3. Keep the `.csv` it downloads.

=== "Todoist"

    Todoist exports one `.csv` file a project. Either:

    - **Everything**: **Settings > Backups**, and download the latest. It is a `.zip` with a file
      for each project; give Punchlist the `.zip` as it is.
    - **One project**: the project's **...** menu > **Export as a CSV file**. You can choose several
      such files at once.

## 2. Import it

1. In Punchlist: **Settings > Your data > Import from another app**.
2. Pick **TickTick** or **Todoist** under **From**, and choose the file (or files).
3. Punchlist shows what it found (lists, open and closed tasks, tags) and anything it cannot keep,
   before it changes anything. Nothing is imported until you press **Import**.
4. Choose how it lands:
    - **Merge with what you have**: the import goes beside your tasks. Tick **Add to lists with the
      same name** to put an imported "Groceries" into your Groceries list instead of a second one.
    - **Replace what you have**: your own lists, your Mess Drawer's tasks and your tags go to the
      Trash first. Lists other people share with you stay. The dialog says how many.
5. **Import**. It is one step: the undo toast takes all of it back, including what Replace moved to
   the Trash.

Your TickTick or Todoist Inbox goes into Punchlist's **Mess Drawer** (its inbox); every other
list or project becomes a list of the same name, with a colour of its own.

!!! tip "Importing twice"
    The import does not look for tasks you already have. Importing the same file twice with
    **Merge** gives you every task twice. To start again from a newer export, undo the first
    import, or use **Replace**.

## What comes across

| What                         | From TickTick                                                                                                                                          | From Todoist                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Lists                        | Every list; the Inbox into the Mess Drawer                                                                                                             | Every project (named after its file); the Inbox into the Mess Drawer                                                 |
| Folders                      | Not kept: their lists come in on their own                                                                                                             | (Todoist has none)                                                                                                   |
| Sections and kanban columns  | Not kept: their tasks stay in the list                                                                                                                 | Not kept: their tasks stay in the list                                                                               |
| Subtasks                     | Yes, in TickTick's order, up to 5 levels deep                                                                                                          | Yes, from the indent, up to 5 levels deep                                                                            |
| Checklist items              | A checklist in the task's notes, ticked items ticked                                                                                                   | (Todoist has none; sub-tasks come as subtasks)                                                                       |
| Notes and descriptions       | Yes, as written                                                                                                                                        | The description, as written                                                                                          |
| Comments                     | Not in TickTick's backup                                                                                                                               | Added to the task's notes                                                                                            |
| Tags and labels              | Yes; `Work/Calls` becomes a nested tag; emoji kept                                                                                                     | Yes, from `@label` in the task's text; nested with `/` the same way                                                  |
| Priorities                   | High, medium, low, none                                                                                                                                | p1 to high, p2 medium, p3 low, p4 none                                                                               |
| Start and due dates, times   | Yes, all-day or timed, in each task's own time zone; a span keeps its first and last day                                                               | Read from the date as Todoist writes it ("Nov 4 2026 9am", "every monday at 9am"), in your time zone                 |
| Duration                     | A timed span keeps its end                                                                                                                             | A timed task's duration becomes its end time                                                                         |
| Deadlines                    | (TickTick has none)                                                                                                                                    | Todoist's deadline becomes the task's due date                                                                       |
| Repeats                      | Yes, when the rule is one Punchlist follows (daily, weekly on days, monthly on a day or the last day, yearly, until a date or a count)               | Yes, from the date words; `every!` repeats from when you finish it                                                   |
| Reminders                    | Yes, before a timed task, or at a time on an all-day one                                                                                               | Not in Todoist's export                                                                                              |
| Completed tasks              | Yes, closed with the date they were done                                                                                                               | Not in Todoist's export (it holds open tasks only)                                                                   |
| Won't do                     | Yes, closed as won't do                                                                                                                                | (Todoist has none)                                                                                                   |
| When a task was made         | Yes                                                                                                                                                    | Not in Todoist's export                                                                                              |
| Notes (TickTick's note kind) | Come in as tasks                                                                                                                                       | (Todoist has none)                                                                                                   |
| Attachments                  | **No.** The backup holds no files; download the ones you need from TickTick first                                                                    | **No.** The export holds no files                                                                                    |
| Sharing, assignees           | No: the import is yours. Share the lists again in Punchlist                                                                                            | No, the same                                                                                                         |
| List colours, pins, habits, focus records | No                                                                                                                                       | No                                                                                                                   |

A few more things work the way TickTick and Todoist mean them, not literally:

- **Done means done.** A task left open under a completed one (an unticked item in a completed
  TickTick task, say) comes in completed with it.
- **Too deep.** Subtasks deeper than Punchlist's five levels move up under the deepest task they
  can sit under. The preview says how many.
- **Repeats Punchlist cannot follow** (TickTick's "these dates", for one): the task comes in
  without a repeat. The preview counts them.
- **Dates Punchlist cannot read** in a Todoist export come in without a date, and the preview
  counts them too.
- **Reminders it cannot read** are dropped and counted.

## After the import

- Check the counts in the message against TickTick's or Todoist's own.
- Share lists with the people who had them before: [sharing](sharing.md).
- Keep the export file until you are happy. It is also the way back: Punchlist exports TickTick
  and Todoist files too (**Settings > Your data > Export for another app**).

Something came across wrong? [Report it](../about/reporting-bugs.md), and if you can, attach a
small export that shows it with the private parts edited out.
