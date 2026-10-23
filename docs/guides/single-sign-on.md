# Single sign-on (OIDC)

Any OpenID Connect provider works, several at once: Pocket ID, Authelia, Authentik, Keycloak,
Zitadel, Kanidm, Microsoft Entra ID, Google and others. The sign-in page shows a "Continue with ..."
button for each.

## Setting it up

1. In the provider, create a client (also called an application) for Punchlist:
   - **Redirect URI**: `https://tasks.example.com/auth/oidc/<name>/callback`, where `<name>` is the
     name you give the provider below (lowercase).
   - **Type**: confidential (with a secret) is usual; a public client also works, since Punchlist
     always uses PKCE.
   - **Scopes**: `openid profile email`, plus `groups` if you will use groups.
2. Set `PUBLIC_URL` to the address people open, and the provider's settings:

```yaml
environment:
  PUBLIC_URL: https://tasks.example.com
  OIDC_PROVIDERS: pocket
  OIDC_POCKET_AUTHORITY: https://id.example.com
  OIDC_POCKET_CLIENT_ID: punchlist
  OIDC_POCKET_CLIENT_SECRET_FILE: /run/secrets/oidc_secret
  OIDC_POCKET_DISPLAY_NAME: Pocket ID
```

3. Restart. Or do all of it from **Admin > Settings** (or the first-start setup), which shows the
   redirect URI to register.

Every `OIDC_<NAME>_*` setting is in [all settings](../configuration/reference.md#per-provider-oidc_name_).

## Who gets in

| Setting                                                     | Effect                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `OIDC_<NAME>_REQUIRED_GROUPS=punchlist`                     | Only members of at least one of these groups may sign in. Checked at every sign-in.                           |
| `OIDC_<NAME>_AUTO_CREATE=true`                              | A first sign-in makes an account. Off (the default): the person waits under **Admin > Sign-in** for approval. |
| `OIDC_<NAME>_ROLE_MAP=punchlist-admins=admin,it=superadmin` | Roles from groups, set at every sign-in. The highest match wins; no match means `user`.                       |
| `OIDC_<NAME>_GROUP_MAP=family=Family`                       | Server group membership from provider groups. `*` mirrors every provider group.                               |
| `LOCAL_LOGIN=hidden`                                        | Hide the password form; `/login?local` still shows it, for an admin.                                          |

A new account never takes over an existing one with the same username: it gets a number after the
name. Usernames come from `preferred_username` (`OIDC_<NAME>_USERNAME_CLAIM`), else the email.

## Linking accounts

People link a provider to their existing account under **Settings > Sign-in**, and unlink it as
long as another way to sign in remains. An admin can link one by hand (**Admin > Users > Link a
provider account**, with the provider and the account's `sub`), or join a waiting sign-in to an
existing person (**Admin > Sign-in > Link to an account**).

`OIDC_<NAME>_LINK_BY_EMAIL=true` lets a first sign-in join the one account that already has the same
email, when the provider marks the email verified. It is off by default: a provider that does not
truly verify emails would let someone take over an account.

## Moving to another provider

To move everyone from `pocket` to `keycloak` without losing accounts:

```bash
# 1. Add keycloak to OIDC_PROVIDERS (keep pocket for now) and restart.
# 2. For a day, a first sign-in through keycloak joins the account with the same username.
docker exec punchlist punchlist oidc migration-window keycloak 24
# 3. Detach everyone from the old provider (accounts and data stay).
docker exec punchlist punchlist oidc unbind-all pocket
# 4. People sign in with keycloak. Then close the window and remove pocket.
docker exec punchlist punchlist oidc migration-window keycloak close
```

A migration window never joins an account that already has a keycloak link, and it matches
usernames only, so check that both providers hand out the same usernames. Someone left with no way
in gets a one-time link: `punchlist admin login-link kim`.

## Provider notes

=== "Pocket ID"

    Create an OIDC client with the callback URL. Groups come with the `groups` scope; nothing else
    to set. Authority: `https://id.example.com`.

=== "Authentik"

    Create an OAuth2/OpenID **Provider** (confidential, the redirect URI as *strict*) and an
    **Application** using it. Authority: `https://auth.example.com/application/o/<application-slug>/`.
    Groups arrive in the `groups` claim; nothing else to set.

=== "Authelia"

    Add a client under `identity_providers.oidc.clients` with `redirect_uris` and
    `scopes: [openid, profile, email, groups]`, `token_endpoint_auth_method: client_secret_basic`.
    Authority: `https://auth.example.com`.

=== "Keycloak"

    Create an OpenID Connect client with *Client authentication* on. Keycloak has no `groups`
    scope: add a **Group Membership** mapper (token claim name `groups`, *Full group path* off) to
    the client's dedicated scope, and set `OIDC_<NAME>_SCOPES=openid profile email`. Authority:
    `https://keycloak.example.com/realms/<realm>`.

=== "Microsoft Entra ID"

    Register an app (web platform, the redirect URI). The groups claim holds group **ids**, not
    names: map the ids in `REQUIRED_GROUPS`, `ROLE_MAP` and `GROUP_MAP`. Authority:
    `https://login.microsoftonline.com/<tenant-id>/v2.0`.

=== "Google"

    Create an OAuth client (web application). Google has no groups claim, so leave the group
    settings out and approve people by hand, or turn on `AUTO_CREATE` with care (any Google account
    could then sign in). Authority: `https://accounts.google.com`.

## Troubleshooting

- **"redirect_uri mismatch"** at the provider: `PUBLIC_URL` and the registered URI differ (scheme,
  host, the provider name in the path, a trailing slash).
- **Signed in, then "not allowed"**: the person is in none of `REQUIRED_GROUPS`, or the provider
  sends no `groups` claim (see the provider notes).
- **Waiting for approval**: `AUTO_CREATE` is off; approve them under **Admin > Sign-in**.
- The [event log](logging.md#access-and-event-log) records each provider sign-in and why one was
  refused.
