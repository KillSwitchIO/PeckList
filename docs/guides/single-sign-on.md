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

`ROLE_MAP` acts only when someone signs in through that provider. A person taken out of the admin
group who does not sign in there again keeps the role, through an API key, a password or a passkey.
To take a role away now, remove them from the group and also lower or disable the account in
PeckList. Both steps matter: lowered by hand only, the next sign-in with the group puts the role back.

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

1. **A mapping.** `OIDC_<NAME>_USER_MAP=ben=bendimit,kim.lee=kim` sends the provider user on the
   left to the PeckList account on the right, every time. Admins add more on **Admin > Sign-in >
   Mappings** (the setting wins when both name the same provider user). A mapping also moves a link:
   someone already linked to another account lands in the mapped one at their next sign-in.
2. **A migration window**, while one is open (see [moving to another provider](#moving-to-another-provider)).
3. **The same username**, with `OIDC_<NAME>_LINK_BY_USERNAME`:
   - `true` joins the account named like the provider's username, if that account has no link to
     this provider yet, and only when it is a plain user account.
   - `all` joins admin accounts too. Use it only when people cannot change their own username at
     the provider: Pocket ID, for one, lets them by default, which would let anyone sign in as an
     admin by renaming themselves. Map admins with `USER_MAP` instead.
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

A migration window never joins an account that already has a keycloak link, and it matches
usernames only, so check that both providers hand out the same usernames. It never joins an admin
account either (someone could rename themselves at the new provider to take it), unless
`OIDC_<NAME>_LINK_BY_USERNAME=all`; map admins with `USER_MAP` instead. Someone left with no way
in gets a one-time link: `pecklist admin login-link kim`.

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
