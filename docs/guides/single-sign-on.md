# Single sign-on (OIDC)

Any OpenID Connect provider works, several at once: Pocket ID, Authelia, Authentik, Keycloak,
Zitadel, Kanidm, Microsoft Entra ID, Google and others. The sign-in page shows a "Continue with ..."
button for each.

## Setting it up

1. In the provider, create a client (also called an application) for PeckList:
   - **Redirect URI**: `https://tasks.example.com/auth/oidc/<name>/callback`, where `<name>` is the
     name you give the provider below (lowercase).
   - **Type**: confidential (with a secret) is usual; a public client also works, since PeckList
     always uses PKCE.
   - **Scopes**: `openid profile email`, plus `groups` if you will use groups. PeckList asks for
     `groups` by itself as soon as any group setting (`REQUIRED_GROUPS`, `ROLE_MAP`, `GROUP_MAP`)
     is set; `OIDC_<NAME>_SCOPES` overrides the list for providers that have no such scope.
   - **Client authentication**: the secret goes in the token request's body
     (`client_secret_post`). Most providers accept it by default; Authelia needs it set.
2. Set `PUBLIC_URL` to the address people open, and the provider's settings:

```yaml
environment:
  PUBLIC_URL: https://tasks.example.com
  OIDC_PROVIDERS: pocket
  OIDC_POCKET_AUTHORITY: https://id.example.com
  OIDC_POCKET_CLIENT_ID: pecklist
  OIDC_POCKET_CLIENT_SECRET_FILE: /run/secrets/oidc_secret
  OIDC_POCKET_DISPLAY_NAME: Pocket ID
```

3. Restart. Or do all of it from **Admin > Sign-in** (or the first-start setup), which shows the
   redirect URI to register.

Every `OIDC_<NAME>_*` setting is in [all settings](../configuration/reference.md#per-provider-oidc_name_).

## The Android app

The app signs in through the same provider and the same redirect URI, in a browser tab instead of
inside the app (passkeys do not work inside apps, and some providers refuse them). There is
nothing extra to register with the provider. After the provider, the person confirms on a
PeckList page, and the app receives a one-time code it can only use with a secret it kept to
itself. The app's session is a copy of the browser's, so `OIDC_<NAME>_SESSION_HOURS` still applies.

## Who gets in

| Setting                                                     | Effect                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `OIDC_<NAME>_REQUIRED_GROUPS=pecklist`                     | Only members of at least one of these groups may sign in. Checked at every sign-in.                           |
| `OIDC_<NAME>_AUTO_CREATE=true`                              | A first sign-in makes an account. Off (the default): the person waits under **Admin > Sign-in** for approval. |
| `OIDC_<NAME>_ROLE_MAP=pecklist-admins=admin,it=superadmin` | Roles from groups, set at every sign-in. The highest match wins; no match means `user`.                       |
| `OIDC_<NAME>_GROUP_MAP=family=Family`                       | Server group membership from provider groups. `*` mirrors every provider group.                               |
| `LOCAL_LOGIN=disabled`                                      | No passwords at all, in the app or the API. An admin gets back in with `pecklist admin login-link`.          |

When someone's groups match nothing in `ROLE_MAP`, they become a plain user at that sign-in.
`ROLE_MAP` decides for everyone who signs in through that provider, so a role an admin gave by hand
goes the same way and does not come back. Every role a sign-in changes, up or down, is in the audit
log as `auth.oidc-role-changed`. The only super admin never loses the role: the server needs one, so
that sign-in logs a warning and an `auth.oidc-role-kept` audit event instead.

A role from `ROLE_MAP` lasts while that provider keeps renewing it: each sign-in through it does.
When nobody signs in there for [`ROLE_MAP_RENEW_DAYS`](../configuration/reference.md#role_map_renew_days)
(14 by default), the role drops to `user`, with an `auth.role-lease-lapsed` audit event and a log
line. So a person taken out of the admin group who never signs in there again loses the role within
that time, along with everything that acts with it: their API keys, a password, a passkey, a sign-in
through a provider with no `ROLE_MAP`. A sign-in that `REQUIRED_GROUPS` refuses renews nothing. A
role an admin sets by hand, under **Admin > Users** or with `pecklist admin set-role`, is not renewed
and does not lapse, unless they sign in through a provider whose `ROLE_MAP` then sets it. To keep the
role someone already has without a lease (an automation account, say), run
`pecklist admin set-role <name> <role>` with that same role: the menu under **Admin > Users** offers
only the other roles.
The only super admin keeps the role, with an `auth.role-lease-kept` event and a warning once a day.

To take a role away at once, remove them from the group and also lower or disable the account in
PeckList. Both steps matter: lowered by hand only, the next sign-in with the group puts the role back.

Upgrading from a version without renewal, a role a linked provider's `ROLE_MAP` can give starts
renewal on the first start, counted from that day.

A provider may also send no groups at all. It may have dropped the claim from one sign-in, or it may
leave the claim out for someone in no groups, as Microsoft Entra ID and Okta reportedly do. PeckList
cannot tell these apart, so a sign-in with no groups lowers the role either way. It logs a warning,
and the audit event names the account and the provider. If the claim was dropped, a role from
`ROLE_MAP` returns at the next sign-in with groups. `GROUP_MAP` treats a sign-in with no groups the
same way, without a warning or an event: the server groups it gave are taken away, and come back at
the next sign-in with groups.

To have a sign-in with no groups refused instead, so a dropped claim lowers nobody, set
`OIDC_<NAME>_REQUIRED_GROUPS` to a group everyone stays in. The catch: someone taken out of every
group then cannot sign in through the provider, and the account keeps its role. A session they
already have, an API key, a password or a passkey all go on working with that role, so lower or
disable the account as above.

A new account never takes over an existing one with the same username: it gets a number after the
name, unless you turn on [username linking](#linking-accounts). Usernames come from
`preferred_username` (`OIDC_<NAME>_USERNAME_CLAIM`), else the email.

## Signing out

Signing out of PeckList ends the PeckList session only: the provider still knows the person, so
**Continue with** signs them straight back in. On a shared computer that is not what you want. With
`OIDC_<NAME>_SIGN_OUT=true`, signing out also ends the provider session (OpenID Connect
RP-initiated logout), and the provider sends the browser back to the sign-in page.

For that, the provider must:

- advertise an `end_session_endpoint` in its discovery document (Authentik, Keycloak, Pocket ID,
  Zitadel, Authelia and Entra ID do), and
- accept `<PUBLIC_URL>/login` as a post-logout redirect URI. Add it next to the callback address in
  the client's settings (Keycloak: **Valid post logout redirect URIs**; Authentik: the provider's
  redirect URIs).

If the provider cannot be reached, PeckList still signs out and only its own session ends.

## Linking accounts

People link a provider to their existing account under **Settings > Account > Sign-in**, and unlink it as
long as another way to sign in remains. An admin can link one by hand (**Admin > Users > Link a
provider account**, with the provider and the account's `sub`), or join a waiting sign-in to an
existing person (**Admin > Sign-in > Link to an account**).

A first sign-in can also find its account by itself. PeckList tries these in order, and the first
that matches wins:

1. **A mapping.** `OIDC_<NAME>_USER_MAP` sends a provider account to a PeckList account, in one of
   two forms:
   - `sub:auth0|abc123=sam` names the provider's subject, which never changes for a person. It
     decides every time, works for admin accounts, and moves a link: someone already linked to
     another account lands in this one at their next sign-in. **Prefer this form, and always use it
     for admins.** A subject with a comma in it cannot be written here: link it by hand instead, and
     check the list under **Admin > Sign-in > Mappings** shows what you meant.
   - `kim.lee=kim` names a provider username, and is a first claim only: for someone with no link
     yet, on an account with no link to this provider yet. After that the link decides, so renaming
     yourself at the provider claims nothing. Before that first sign-in, whoever holds the username
     gets the account. Where people can rename themselves at the provider, anyone can take an entry
     nobody has claimed yet, including someone who already has an account here. Use a `sub:` entry
     there. An admin account also needs `LINK_BY_USERNAME=all`; without it the sign-in goes on to the
     next step, and an `auth.oidc-mapping-refused` audit event says what to do.

   A username entry matches the name the provider sends exactly, ignoring only upper and lower case
   and spaces around it. A provider that sends `kim@corp.example` needs that written in full, and a
   sign-in with no username claim matches nothing here, whatever its email.

   A username entry in the setting stays there. Whenever its account has no link to this provider,
   the entry works as a first claim again: after the person removes their own link, after an admin
   unlinks them or moves the link, and for everyone at once after **Unbind all**. Take it out of the
   setting once the person has signed in.

   Someone re-created at the provider has a new subject. A username entry no longer finds their old
   account once it is linked, so they land in a new one. Move the link by hand, or use a `sub:` entry.

   Admins add username mappings on **Admin > Sign-in > Mappings** (the setting wins when both name
   the same provider user, even when the account it names is gone). A saved one is deleted once
   used, with an `auth.oidc-mapping-used` audit event, and the account's link takes over.
2. **A migration window**, while one is open (see [moving to another provider](#moving-to-another-provider)).
3. **The same username**, with `OIDC_<NAME>_LINK_BY_USERNAME`:
   - `true` joins the account named like the provider's username, if that account has no link to
     this provider yet, and only when it is a plain user account. The name must match exactly, as a
     username mapping does: only upper and lower case and spaces around it may differ, and a
     sign-in with no username claim matches nothing here, whatever its email.
   - `all` joins admin accounts too. Use it only when people cannot change their own username at
     the provider: Pocket ID, for one, lets them by default, which would let anyone sign in as an
     admin by renaming themselves. Map admins with a `sub:` entry in `USER_MAP` instead.
4. **The same verified email**, with `OIDC_<NAME>_LINK_BY_EMAIL=true`: the one account that already
   has that email from another provider. Off by default: a provider that does not truly verify
   emails would let someone take over an account.
5. Otherwise a new account (`AUTO_CREATE`) or a wait for an admin.

Linking, mapping and moving only change which account a provider account signs into. Tasks, lists
and shares never move from one account to another; an account that lost its link keeps everything
and can be deleted or handed over from **Admin > Users**.

Once a provider is set, **Admin > Sign-in** lists every account with the provider
accounts that sign into it: the provider, the username it sent, and when it was last used. From
there an admin maps a provider username to an account, moves a provider account to another
account, or unlinks it. Every change goes into the event log.

### Provider icons

People who signed in through a provider see its icon on their profile picture. PeckList uses
`OIDC_<NAME>_ICON` (an `https` address or a file in the container), else the provider's own
`/favicon.ico`, and keeps a copy for a day, so browsers never load it from the provider. Without an
image there, no icon shows.

A first sign-in also brings in the person's picture from the provider's `picture` claim, when their
profile has no photo. Many providers let people set that address themselves, so PeckList fetches
it only from public internet addresses, or from the host of a configured provider (one on your own
network is fine). Anything else, and redirects to it, is refused and the profile keeps its initials.

## Moving to another provider

To move everyone from `pocket` to `keycloak` without losing accounts:

```bash
# 1. Add keycloak to OIDC_PROVIDERS (keep pocket for now) and restart.
# 2. For a day, a first sign-in through keycloak joins the account with the same username.
docker exec pecklist pecklist oidc migration-window keycloak 24
# 3. Detach everyone from the old provider (accounts and data stay).
docker exec pecklist pecklist oidc unbind-all pocket
# 4. People sign in with keycloak. Then close the window and remove pocket.
docker exec pecklist pecklist oidc migration-window keycloak close
```

A migration window never joins an account that already has a keycloak link, and it matches the
username exactly, as `LINK_BY_USERNAME` does: only upper and lower case and spaces around it may
differ, and a sign-in with no username claim, or one that sends an email address as its username,
joins nothing. The match is against the PeckList username shown under **Admin > Users**, not the
old provider's: an account the old provider made may have a simplified one (`José` became `jose`).
Check that the new provider sends those usernames; for a provider that sends
emails, add a `USER_MAP` entry for each person, or have each person link it from their account
before the move. It never joins an admin
account either (someone could rename themselves at the new provider to take it), unless
`OIDC_<NAME>_LINK_BY_USERNAME=all`; map admins with a `sub:` entry in `USER_MAP` instead. Someone left with no way
in gets a one-time link: `pecklist admin login-link kim`.

**Admin > Settings** refuses to remove or rename a provider that still has accounts linked, and says
how many: those people would lose a way in without anyone having chosen that. Use **Unbind all**
under **Admin > Sign-in** or `pecklist oidc unbind-all` first (accounts and their data stay), then
remove it. While another admin is linked to the provider, **Unbind all** takes a super admin. PeckList
cannot refuse a provider taken out of the environment or the config file. Its links then stay in the
database and sign nobody in, so they no longer count as a way in: someone with only such a link left
cannot remove their password, as with no way in at all. Each start logs a warning for every such
provider, with how many links it still has, and `pecklist oidc unbind-all <name>` clears them.

Removing a provider takes effect at the restart: until then people can still sign in with it.
Sessions it already made carry on until they end, and neither **Unbind all** nor the removal stops
them. If you are removing a provider because you no longer trust it, restart at once and disable the
accounts that matter.

Links go by the provider's name and subject, so use a new name for a different identity server.

## Provider notes

<Tabs>
<TabItem value="google" label="Google">

"Continue with Google" for anyone with a Google account, with no groups. Name the provider
`google` and only the client id and secret are needed: the authority
(`https://accounts.google.com`), the button and its label come filled in. A provider with
another name gets the same with `OIDC_<NAME>_PRESET=google`.

```yaml
OIDC_PROVIDERS: google
OIDC_GOOGLE_CLIENT_ID: 123-abc.apps.googleusercontent.com
OIDC_GOOGLE_CLIENT_SECRET_FILE: /run/secrets/google_client_secret
OIDC_GOOGLE_AUTO_CREATE: 'true'   # or let an admin approve each new person
```

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials): set up the
OAuth consent screen (External, with your server's address as an authorized domain), then
**Create credentials > OAuth client ID > Web application**, with the callback URL above as an
authorized redirect URI. Google has no username claim: a new account takes the part of the
email before the `@`. Google has no groups, so leave the group settings out (with one set,
PeckList would ask for a `groups` scope Google refuses). The Android app signs in through the
browser, which Google requires.

</TabItem>
<TabItem value="pocket-id" label="Pocket ID">

Create an OIDC client with the callback URL. Groups come with the `groups` scope; nothing else
to set. Authority: `https://id.example.com`.

</TabItem>
<TabItem value="authentik" label="Authentik">

Create an OAuth2/OpenID **Provider** (confidential, the redirect URI as *strict*) and an
**Application** using it. Authority: `https://auth.example.com/application/o/<application-slug>/`.
Groups arrive in the `groups` claim; nothing else to set.

</TabItem>
<TabItem value="authelia" label="Authelia">

Add a client under `identity_providers.oidc.clients`. PeckList sends its client secret in the
token request's body, so the client must use `client_secret_post` (Authelia's default for a
confidential client is `client_secret_basic`, which fails with `invalid_client`):

```yaml
- client_id: pecklist
  client_name: PeckList
  client_secret: '$pbkdf2-sha512$...'   # the hash of OIDC_<NAME>_CLIENT_SECRET
  public: false
  authorization_policy: two_factor
  require_pkce: true
  pkce_challenge_method: S256
  redirect_uris:
    - https://tasks.example.com/auth/oidc/authelia/callback
  scopes: [openid, profile, email, groups]
  response_types: [code]
  grant_types: [authorization_code]
  response_modes: [query]
  token_endpoint_auth_method: client_secret_post
```

Authority: `https://auth.example.com`.

</TabItem>
<TabItem value="keycloak" label="Keycloak">

Create an OpenID Connect client with *Client authentication* on. Keycloak has no `groups`
scope: add a **Group Membership** mapper (token claim name `groups`, *Full group path* off) to
the client's dedicated scope, and set `OIDC_<NAME>_SCOPES=openid profile email`. Authority:
`https://keycloak.example.com/realms/<realm>`.

</TabItem>
<TabItem value="microsoft-entra-id" label="Microsoft Entra ID">

Register an app (platform **Web**, the redirect URI) and give it a client secret. Entra has no
`groups` scope and refuses a sign-in that asks for one, so set
`OIDC_<NAME>_SCOPES=openid profile email` whenever you use any group setting. Groups come from
the app's **Token configuration > Add groups claim** (security groups) instead. The claim holds
group **object ids**, not names: use the ids in `REQUIRED_GROUPS`, `ROLE_MAP` and `GROUP_MAP`.
`preferred_username` is the person's sign-in name (`kim@contoso.com`), so usernames look like
email addresses. Authority: `https://login.microsoftonline.com/<tenant-id>/v2.0`.

</TabItem>
</Tabs>

## Troubleshooting

- **"redirect_uri mismatch"** at the provider: `PUBLIC_URL` and the registered URI differ (scheme,
  host, the provider name in the path, a trailing slash).
- **Signed in, then "not allowed"**: the person is in none of `REQUIRED_GROUPS`, or the provider
  sends no `groups` claim (see the provider notes).
- **Waiting for approval**: `AUTO_CREATE` is off; approve them under **Admin > Sign-in**.
- The [event log](logging.md#access-and-event-log) records each provider sign-in and why one was
  refused.
