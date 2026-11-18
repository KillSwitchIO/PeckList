---
title: Deleting your account
description: How to delete your PeckList account in the app or through your server's admin, what is deleted, and how long it can be restored.
---

# Deleting your account

This page covers PeckList, by KillSwitch10: the Android app (from Google Play or the GitLab
releases) and the web app.

Your PeckList account is kept on the server you signed in to, not by the project. You can delete it
yourself in the app, or ask that server's admin to delete it.

## In the app

1. Open **Settings > Account**.
2. Choose **Delete my account**. The app says what will be deleted and how many days the server
   keeps it before it is gone for good.
3. Show that it is you: type your password, or, if your account has none (you sign in with a
   provider or a passkey), sign in again and then delete within 10 minutes.
4. Confirm. You are signed out, on this device and every other.

**Delete my account** is in PeckList 0.13.0 and later. If your server runs an older version, ask
its admin.

A server always keeps at least one super admin, so if that is you, the app refuses: make someone
else a super admin first (**Admin > Users**).

## What is deleted, and when

- **At once:** the account is turned off. Its sessions and tokens end, so it is signed out
  everywhere and nobody can sign in to it.
- **After the grace period:** the account is removed for good, with everything only it uses: its
  own tasks, lists, tags, comments, files and settings. A list or group you shared goes to the next
  person in it, with everything in it, and what you added to other people's lists stays there.
  Friendships end, and its passkeys, API keys and provider links are removed. The server's admin
  sets the grace period (7 days unless they changed it), and the app shows it before you confirm.
- **Backups:** if the server keeps backups, copies made before the deletion stay in them until
  they are replaced, on the schedule the server's admin sets.
- **On your phone:** the Android app's offline copy is removed when you uninstall the app.

## Changing your mind

During the grace period the server's admin can restore the account, with everything in it, from
**Admin > Users > Restore**. You cannot restore it yourself, because a deleted account cannot sign
in, so ask the admin.

## On someone else's server

If someone else runs your server (a family member, a friend, your workplace), they control the data
on it. You can also ask them to delete your account; they can remove it at once instead of waiting
for the grace period.

## On the demo server

On demo.pecklist.com, a deleted account is removed at once, with no grace period, and cannot be
restored. The whole demo is also erased every night and starts again from scratch; the shared demo
accounts come back after the reset.

## Data the project holds

The project never holds your account or your tasks. What does reach the project (crash reports you
send, anonymous usage reports, supporter key purchases), how long it is kept and how to have it
deleted are in the [privacy policy](/privacy-policy/).
