---
title: Privacy policy
description: What data PeckList's apps, servers and websites send to the project, how long it is kept, and how to delete it.
---

# Privacy policy

Last changed 17 November 2026.

This policy covers PeckList: the web app, the Android app (the Google Play build and the APK from
the GitLab releases alike) and the project's websites, pecklist.com, selfhosted.pecklist.com,
docs.pecklist.com and demo.pecklist.com. Every request is described in full, field by field, in
[Privacy and telemetry](/using/privacy/).

## Who is responsible

PeckList is made by KillSwitch10, who is responsible for the data this policy describes.
Contact: [support@pecklist.com](mailto:support@pecklist.com).

## Your tasks are on your server

PeckList has no central service that holds your tasks. Your account, tasks, lists, comments and
files are kept on the PeckList server you connect the app to, and **the person who runs that server
(its admin) controls them**: what is kept, for how long, its backups, and deleting it. If you run
your own server, that is you. If you use someone else's server, ask its admin; their own terms
apply. The project cannot see, change or delete anything on a server it does not run.

The apps talk only to the server you connect them to, and contain no advertising. The Android app
also keeps a copy of your tasks on the phone so that it works offline (with **Use on this device
only**, everything stays on the phone). Uninstalling the app removes that copy.

## What reaches the project

From the apps and from servers that other people run, only the four things below reach the project
(or, for the update check, GitLab). None of them holds your tasks, list or tag names, notes,
comments, files, your name, username or email, or the server's address.

- **Crash reports**, only when you send one. When the app hits an error it cannot get past, it
  shows you the report in full and asks: **Send**, **Don't send**, **Always send** or **Never
  send**. A report holds the app's version, the kind of device, the error and where in the app's
  code it happened, with web addresses, emails and long ids taken out. It goes through your server,
  which adds its random install id.
- **Usage counts**, only when your server sends its daily report and you share. The apps count a
  fixed list of things (views opened, features used, errors by a short fingerprint, how long
  starting, syncing and searching take) and send the counts to your server, never anywhere else.
  The server adds them up into its daily report. Turn it off for all your devices in **Settings >
  Your data > Usage stats > Share anonymous usage stats**.
- **The server's daily usage report.** Once a day a server sends ranges and switches about itself
  (version, setup, size) with a random install id. It is on by default, and its admin can see it
  exactly as sent and turn it off.
- **The update check.** Twice a day a server asks GitLab for PeckList's latest release. This request
  goes to GitLab, not to the project, and carries only what any web request shows (the server's IP
  address) and its version. GitLab's own privacy policy applies to it.

The project's collector does not read or keep the IP address a report comes from. It keeps the
country, as two letters, which Cloudflare (in front of the collector) works out from the address.
Demo servers send none of this.

## The project's websites and the demo

- **Visit counts:** the websites use [Umami](https://umami.is/), run by the project at
  stats.pecklist.com, with no third-party analytics. Page views are counted without cookies, so
  the project knows how many people visit and which pages they read. Your IP address is not kept:
  Umami hashes it with a salt that changes, to count unique visitors, and reads your country from
  it.
- **Session replays:** the pages you see, your clicks and your scrolling are recorded so the project
  can see where people get stuck. Form fields are hidden, but other text on the page is recorded.
  **On the demo, that includes the tasks you add once they show on screen.**
- **The demo server** is public: other visitors can sign in to the demo accounts, and everything on
  it is erased at its nightly reset. Keep real details out of it.
- **Cloudflare** sits in front of the websites and handles your IP address to deliver and protect
  them, under [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
- **Ko-fi:** the support page on pecklist.com loads Ko-fi's tip panel. Ko-fi sees that visit and
  handles any tip under its own privacy policy.

## Supporter key purchases

Supporter keys are bought on the project's website through Paddle, which is the merchant of
record: Paddle takes the payment and holds your name, email, address and payment details, under
[Paddle's privacy policy](https://www.paddle.com/legal/privacy). The project gets the order's
transaction id from Paddle, asks Paddle for your email only to send you the key, and never stores
it. The project keeps the transaction id, the keys and when they were emailed.

## How long each kind of data is kept

| Data                                                                                                            | Kept                                                               |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Daily usage reports (with their install id)                                                                     | 90 days                                                            |
| Crash reports                                                                                                   | 90 days                                                            |
| Daily totals made from the reports (how many installs had each version or setting on a day, with no install id) | No end date                                                        |
| A crash report your server could not deliver yet                                                                | On your server, until it is sent (it tries again within the hour)  |
| Supporter key records: transaction id, keys, when they were emailed                                             | No end date                                                        |
| Paddle's customer id for an order                                                                               | Until the key email has gone out, or been given up after 100 tries |
| Your email, for a supporter key                                                                                 | Never stored by the project                                        |
| Website visit counts and session replays                                                                        | 30 days                                                            |
| Anything on the demo server                                                                                     | Until its next reset, every night                                  |
| Your account and tasks                                                                                          | On your server, for as long as its admin decides                   |

## Deleting your data

- **Your account and tasks:** delete your account in the app, or ask your server's admin. See
  [Deleting your account](/delete-account/).
- **Stop sending:** turn off **Settings > Your data > Usage stats > Share anonymous usage stats**,
  and choose **Never send** for crash reports. A server's admin can turn off the daily report and
  the update check for everyone.
- **Reports already sent:** they hold no name or account, so the project cannot find yours by who
  you are. A server's admin can ask [support@pecklist.com](mailto:support@pecklist.com) to delete its reports, giving the install id shown
  in **Admin > General > Telemetry > See what's sent**, and can make a new install id there.
  Otherwise reports go after 90 days.
- **A supporter key purchase:** write to [support@pecklist.com](mailto:support@pecklist.com) with the transaction id or the key. Keys are
  checked offline, so deleting the record does not stop a key from working. For Paddle's own
  records, ask Paddle.
- **Website visits and replays:** write to [support@pecklist.com](mailto:support@pecklist.com).

## Children

PeckList is not aimed at children, and the project does not knowingly collect data about them.

## Changes to this policy

A change to this policy updates the date at the top. Every earlier version is in
[the repository's history](https://gitlab.com/killswitch10/pecklist/-/commits/main/website/src/pages/privacy-policy.md).
