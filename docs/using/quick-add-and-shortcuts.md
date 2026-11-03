# Quick add and shortcuts

## Quick add

Type a whole task in one line; a long one wraps and the box grows, so it stays easy to read and
fix. What PeckList recognises turns into a chip on the line under the text as you type and comes
out of the title; the cross on a chip keeps those words as plain text instead.

```text
Call the vet tomorrow 3pm #pets !high ^Home
```

makes the task **Call the vet**, starting tomorrow at 15:00, tagged `pets`, high priority, in the
list Home.

| Write          | Sets                | Examples                                                                                             |
| -------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| A date or time | The start           | `today`, `tomorrow 9am`, `fri`, `next monday`, `oct 30`, `in 3 days`, `fri 9-11am` (a span)          |
| `due` + a date | The due date        | `due fri`, `due by friday`, `due on oct 30`                                                          |
| `every` ...    | How it repeats      | `every day`, `every 3 days`, `every weekday`, `every other week`, `every mon and thu`, `every month` |
| `#tag`         | A tag (made if new) | `#errands`, `#home/garden`; `#garden` finds `home/garden` when it is the only one                    |
| `!priority`    | Priority            | `!high` `!h` `!1`, `!medium` `!med` `!m` `!2`, `!low` `!l` `!3`, `!none` `!0`                        |
| `^list`        | The list            | `^home`, `^groc` (the start of a name is enough)                                                     |
| `@person`      | Assign it           | `@kim` (people you share with, by name or username)                                                  |

Without `^list`, the task goes to the list you are in (or the Mess Drawer from a view).

## Keyboard shortcuts

Press <kbd>?</kbd> anywhere for this list. Shortcuts are plain keys, never fire while you type, and
stay clear of the browser's own.

| Keys                                     | Does                                             |
| ---------------------------------------- | ------------------------------------------------ |
| <kbd>Q</kbd>                                    | Add a task                                       |
| <kbd>/</kbd>                                | Search                                           |
| <kbd>?</kbd>                             | Show the shortcuts                               |
| <kbd>G</kbd> then <kbd>T</kbd>                         | Go to Today                                      |
| <kbd>G</kbd> then <kbd>I</kbd>                         | Go to the Mess Drawer                            |
| <kbd>G</kbd> then <kbd>N</kbd>                         | Go to Upcoming                                   |
| <kbd>G</kbd> then <kbd>D</kbd>                         | Go to Due dates                                  |
| <kbd>G</kbd> then <kbd>A</kbd>                         | Go to All                                        |
| <kbd>G</kbd> then <kbd>C</kbd>                         | Go to Calendar                                   |
| <kbd>G</kbd> then <kbd>S</kbd>                         | Go to Settings                                   |
| <kbd>J</kbd> / <kbd>K</kbd>                            | Next / previous task                             |
| <kbd>E</kbd>                                    | Edit the title                                   |
| <kbd>Space</kbd>                                | Complete or reopen                               |
| <kbd>Del</kbd>                               | Move to the trash                                |
| <kbd>Alt</kbd>+<kbd>Up</kbd> / <kbd>Alt</kbd>+<kbd>Down</kbd>    | Move the task up or down                         |
| <kbd>Alt</kbd>+<kbd>Right</kbd> / <kbd>Alt</kbd>+<kbd>Left</kbd> | Make it a subtask of the one above / take it out |
