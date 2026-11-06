# Getting help

PeckList is made by one person in their spare time, with help from anyone who joins in. There is
no paid support; these are the places to ask, and what each is for.

| You want to                         | Go to                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Fix something that is not working   | First [troubleshooting](../guides/troubleshooting.md) and the [FAQ](../faq.md), then a [bug report](reporting-bugs.md)                   |
| Report a bug                        | A [GitLab issue](https://gitlab.com/killswitch10/pecklist/-/issues/new?issuable_template=Bug), as in [reporting a bug](reporting-bugs.md) |
| Ask for a feature                   | A [feature request](https://gitlab.com/killswitch10/pecklist/-/issues/new?issuable_template=Feature%20request); check the [roadmap](roadmap.md) first |
| Report a security problem           | Privately, as a confidential issue: see the [security policy](https://gitlab.com/killswitch10/pecklist/-/blob/main/SECURITY.md). Never in public |
| Ask a question, show your setup     | The community chat (below)                                                                                                               |
| Help build it                       | [Contributing](https://gitlab.com/killswitch10/pecklist/-/blob/main/CONTRIBUTING.md) and [developing](../development/index.md)          |

## Support PeckList

PeckList is free and made in spare time. If it helps you, a donation helps keep it going and
covers its costs:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/S6S7P3FVW)

Or use the tip panel on [pecklist.com/support](https://pecklist.com/support/).

## Community chat

:::note[Not open yet]

A Discord server is planned for the 1.0 release, with a forum for support questions (one
thread a question), channels for releases, the Android testers and people's setups. Until it
opens, ask in a [GitLab issue](https://gitlab.com/killswitch10/pecklist/-/issues); questions
are welcome there too.

:::

{/* When the Discord server opens: replace the note above with its invite link, and add it to the
README and docs/index.md. */}

## What to expect

- Bug reports get a first answer within a few days, usually sooner. A report with the version and
  a [debug dump](../guides/logging.md#debug-dump) gets fixed fastest.
- Fixes ship in the next release; only the latest release is supported, so the fix for an old
  version is to upgrade.
- Feature requests are read and labelled, and the ones that fit go on the [roadmap](roadmap.md).
  Not every one will: PeckList tries to stay small and easy to run.

## Following releases

- The [release page](https://gitlab.com/killswitch10/pecklist/-/releases) and the
  [changelog](https://gitlab.com/killswitch10/pecklist/-/blob/main/CHANGELOG.md).
- In the app: the server checks for releases twice a day and shows a notice
  ([`UPDATE_CHECK`](../configuration/reference.md#update_check)).
- On GitLab: **Notifications** on the project page, set to **Custom > New release**.
