# Quick add and shortcuts

## Quick add

Type a whole task in one line. What Punchlist recognises turns into a chip as you type and comes
out of the title; click a chip to keep those words as plain text instead.

```text
Call the vet tomorrow 3pm #pets !high ^Home
```

makes the task **Call the vet**, starting tomorrow at 15:00, tagged `pets`, high priority, in the
list Home.

| Write          | Sets                | Examples                                                                                    |
| -------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| A date or time | The start           | `today`, `tomorrow 9am`, `fri`, `next monday`, `oct 30`, `in 3 days`, `fri 9-11am` (a span) |
| `due` + a date | The due date        | `due fri`, `due by friday`, `due on oct 30`                                                 |
| `#tag`         | A tag (made if new) | `#errands`, `#home/garden`; `#garden` finds `home/garden` when it is the only one           |
| `!priority`    | Priority            | `!high` `!h` `!1`, `!medium` `!med` `!m` `!2`, `!low` `!l` `!3`, `!none` `!0`               |
| `^list`        | The list            | `^home`, `^groc` (the start of a name is enough)                                            |
| `@person`      | Assign it           | `@kim` (people you share with, by name or username)                                         |

Without `^list`, the task goes to the list you are in (or the Mess Drawer from a view).

## Keyboard shortcuts

Press ++question++ anywhere for this list. Shortcuts are plain keys, never fire while you type, and
stay clear of the browser's own.

| Keys                                     | Does                                             |
| ---------------------------------------- | ------------------------------------------------ |
| ++q++                                    | Add a task                                       |
| ++slash++                                | Search                                           |
| ++question++                             | Show the shortcuts                               |
| ++g++ then ++t++                         | Go to Today                                      |
| ++g++ then ++i++                         | Go to the Mess Drawer                            |
| ++g++ then ++n++                         | Go to Upcoming                                   |
| ++g++ then ++d++                         | Go to Due dates                                  |
| ++g++ then ++a++                         | Go to All                                        |
| ++g++ then ++c++                         | Go to Calendar                                   |
| ++g++ then ++s++                         | Go to Settings                                   |
| ++j++ / ++k++                            | Next / previous task                             |
| ++e++                                    | Edit the title                                   |
| ++space++                                | Complete or reopen                               |
| ++delete++                               | Move to the trash                                |
| ++alt+arrow-up++ / ++alt+arrow-down++    | Move the task up or down                         |
| ++alt+arrow-right++ / ++alt+arrow-left++ | Make it a subtask of the one above / take it out |
