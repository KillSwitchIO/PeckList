# Users, roles and groups

Everything here is under **Admin**, which only admins see.

## Roles

| Role         | Can                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `user`       | Use the app: their own tasks and lists, and what others share with them.                       |
| `admin`      | Everything a user can, plus manage users and server groups, settings, backups, logs and stats. |
| `superadmin` | Everything an admin can, plus manage admins and view the app as someone else.                  |

Some of that is for super admins only, because an admin who could do it could make themselves a
super admin:

- **Sign-in settings**: identity providers (`OIDC_*`, role and user maps included), `LOCAL_LOGIN`,
  `REGISTRATION`, `TRUSTED_PROXIES` and `PUBLIC_URL`. Admins see them on **Admin > Settings**,
  locked and marked _super admins only_.
- **Whole-server backups**: downloading a snapshot, exporting the whole server and restoring it.
  They hold every password hash and the keys that sign sessions. Admins can still take a backup
  and see the list.
- **Admins' accounts**: only super admins export, restore, hand over or look into (linked accounts,
  friends, shares) an admin's or super admin's account. A person an admin restores from a file
  always comes back as a plain user.

The first account, `admin`, is a super admin. There is always at least one active super admin: the
last one cannot be turned off, deleted or lose the role (from the page, the command line or a
single sign-on role map).

Change a role under **Admin > Users > ... > Make admin**, or:

```bash
docker exec punchlist punchlist admin set-role kim admin
```

With single sign-on, `OIDC_<NAME>_ROLE_MAP` sets roles from the provider's groups at every sign-in
(see [single sign-on](single-sign-on.md)).

## Adding people

- **Admin > Users > Invite**: an invite link people use to make their own account (below).
- **Admin > Users > Add user**: a username and a role. PeckList shows a generated password to hand
  over; it must be changed at the first sign-in.
- From the command line: `punchlist admin add-user kim [--admin]` prints the password.
- **Single sign-on** with `OIDC_<NAME>_AUTO_CREATE=true` makes the account at the first sign-in.
  Without it, the person waits under **Admin > Sign-in** until an admin approves them (or joins them
  to an existing account).

### Self sign-up and invite links

[`REGISTRATION`](../configuration/reference.md#registration) (or **Admin > Settings > Who can join**)
decides who may make their own account:

| Value              | Who can sign up                                                                     |
| ------------------ | ----------------------------------------------------------------------------------- |
| `open`             | Anyone who reaches the server: **Create an account** shows on the sign-in page.     |
| `invite` (default) | Only people with an invite link. The sign-in page shows no sign-up.                 |
| `closed`           | Nobody. Only admins add people, and invite links stop working until this changes.   |

An **invite link** comes from **Admin > Users > Invite**: who it is for (a note only admins see),
how long it lasts (1, 7 or 30 days) and how many people may use it (1, 5, 25 or any number). The
link, `https://tasks.example.com/join/...`, is shown once with a Copy button; only a hash of it is
kept, so make a new one if it is lost. Opening it shows **Create your account**: a username
(lowercase letters, digits, dots, dashes and underscores) and a password of at least 12
characters. The new account is a plain user, signed in at once, with no password change.

Invites that still work are listed under the people, with how many uses are left, until when, and
who joined with them. The **x** withdraws one; accounts made with it stay. Used-up and expired
invites drop off the list.

With single sign-on, the invite page also offers **Continue with** each provider. A new provider
account that would otherwise wait for approval (`AUTO_CREATE` off) comes in on the invite and uses
it up. With `LOCAL_LOGIN=disabled` the invite page offers only the providers.

Every sign-up, invite made and invite withdrawn is in the [event log](logging.md#access-and-event-log).

## Managing an account

From the **...** menu on a person in **Admin > Users**:

| Action                              | What it does                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Reset password**                  | Shows a new password to hand over; they must change it at the next sign-in. Their other sessions end.              |
| **Sign-in link**                    | A link that signs them in once, within 24 hours. For someone with no password and no working provider.             |
| **Turn off** / **Turn on**          | A turned-off account cannot sign in and its sessions end at once. Data stays.                                      |
| **Make user / admin / super admin** | Change the role. Only super admins manage admins.                                                                  |
| **Friends**                         | Make people friends with each other (so they can share), or end a friendship.                                      |
| **Hand over shared lists**          | Give the lists and groups they own and share to someone else. Everyone stays in; the old owner stays as an editor. |
| **Export their data**               | Download one person's data (see [backups](backups.md#one-person)).                                                 |
| **Link a provider account**         | Join a single sign-on identity to this account by hand.                                                            |
| **View as**                         | Super admins: see the app as this person (below).                                                                  |
| **Delete account**                  | See below.                                                                                                         |

### Viewing as someone

To see what someone sees (a support question, a broken list), a super admin opens **View as**, says
why, and gets a new tab showing the app as that person for 30 minutes. A banner stays on the page.
It only looks: nothing done in that tab is saved to their account, and the server refuses any
change sent from it. Starting and ending the view are recorded under the admin's name, with the
reason, in the [event log](logging.md#access-and-event-log). It cannot target another super admin or a turned-off
account, and it ends when the admin signs out.

### Deleting an account

Deleting turns the account off at once and ends its sessions. It is removed for good, with
everything the person owns, after `ACCOUNT_DELETE_GRACE_DAYS` (default 7). Until then the
account's row shows two buttons: **Restore** takes the deletion back, and **Delete now** removes it
for good at once (it asks first), which also frees the username. If they own lists or groups shared
with others, hand those over first; the delete dialog offers it.

Under each user, **Groups** lists the server groups they are in and the groups people made that
they own or belong to.

## Server groups

**Admin > Groups**. A server group is a set of people an admin manages, such as "Family" or
"Support team". Fill it by hand, or from a provider's groups (`OIDC_<NAME>_GROUP_MAP`, see
[single sign-on](single-sign-on.md)).

Turn on **Offered for sharing** and the group appears in its members' apps like a group they made:
they can share lists with it and assign tasks to it. Only admins change who is in it; nobody leaves
it from the app.

## Sign-in protection

- Five wrong passwords lock an account for 15 minutes.
- Each address gets ten sign-in attempts a minute.
- Sessions are HttpOnly cookies that last 30 days of use. Changing a password ends the other
  sessions. Single sign-on sessions last `OIDC_<NAME>_SESSION_HOURS` (default 12) before the app
  checks back with the provider.
