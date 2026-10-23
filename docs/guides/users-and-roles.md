# Users, roles and groups

Everything here is under **Admin**, which only admins see.

## Roles

| Role         | Can                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `user`       | Use the app: their own tasks and lists, and what others share with them.                       |
| `admin`      | Everything a user can, plus manage users and server groups, settings, backups, logs and stats. |
| `superadmin` | Everything an admin can, plus manage admins and view the app as someone else.                  |

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

- **Admin > Users > Add user**: a username and a role. Punchlist shows a generated password to hand
  over; it must be changed at the first sign-in.
- From the command line: `punchlist admin add-user kim [--admin]` prints the password.
- **Single sign-on** with `OIDC_<NAME>_AUTO_CREATE=true` makes the account at the first sign-in.
  Without it, the person waits under **Admin > Sign-in** until an admin approves them (or joins them
  to an existing account).

Self sign-up (`REGISTRATION`) is not built yet.

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
Anything changed there is real and recorded under the admin's name, with the reason, in the
[event log](logging.md#access-and-event-log). It cannot target another super admin or a turned-off
account, and it ends when the admin signs out.

### Deleting an account

Deleting turns the account off at once and ends its sessions. It is removed for good, with
everything the person owns, after `ACCOUNT_DELETE_GRACE_DAYS` (default 7), and can be restored
until then (**Restore account**). If they own lists or groups shared with others, hand those over
first; the delete dialog offers it.

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
