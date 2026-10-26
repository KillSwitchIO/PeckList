# Reverse proxy and HTTPS

Run Punchlist behind a reverse proxy that handles HTTPS. Browsers only install the app, keep it
working offline and allow its service worker on a secure address (HTTPS, or `localhost`), so HTTPS
is not optional for real use.

The setup that works best:

```text
internet --https--> proxy (Caddy) --http--> Punchlist :8080
                                            reachable by the proxy only
```

Punchlist's own port is plain HTTP. Only the proxy should be able to reach it: do not publish
`8080` to your network or the internet. With Docker Compose, leave `ports:` off the Punchlist
service and put the proxy on the same network, as in
[the Caddy example](docker-compose.md#with-https-caddy). For what else to set before going on the
internet, see [Security](../guides/security.md).

## What the proxy must do

Every one of these is needed; without it something breaks.

1. **Forward everything** to Punchlist's port (8080), on one host name, at the root path. Serving it
   under a sub-path (`example.com/tasks`) is not supported.
2. **Pass `X-Forwarded-For` and `X-Forwarded-Proto`**, so the server knows people's real addresses
   (for the access log and the sign-in limits) and that the page was loaded over HTTPS (for the
   `Secure` flag on the session cookie). Caddy, Traefik and the nginx example below do this.
3. **Not buffer `/api/events`**: live updates arrive over a long-lived
   [server-sent events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) stream. A
   buffering proxy delays every update until the buffer fills. Caddy and Traefik send each event at
   once by themselves; nginx needs the extra block in its example.
4. **Allow large uploads** (200 MB is plenty) for restoring backups through the admin page. Caddy
   has no limit unless you set one; nginx's default is 1 MB.

Then set [`PUBLIC_URL`](../configuration/reference.md#public_url) to the HTTPS address, and
[`TRUSTED_PROXIES`](#trusted-proxies) to the proxy.

## Trusted proxies

The server believes `X-Forwarded-*` headers only from addresses in
[`TRUSTED_PROXIES`](../configuration/reference.md#trusted_proxies). The default trusts loopback and
every private range (10/8, 172.16/12, 192.168/16, fc00::/7), so that a proxy on the same host or
Docker network works with no setting.

**Why narrow it:** anything on a private network that can reach port 8080 directly (another machine
on your LAN, a VPN peer, another container on the same Docker network) can then send its own
`X-Forwarded-For` and be believed. It can put any address it likes in the access log, and it gets
around the per-address sign-in limit (ten tries a minute) by claiming a new address for every try.
Account lockout still applies. With only the proxy's address set, nothing else is believed:

```text
TRUSTED_PROXIES=127.0.0.1          # proxy on the same machine
TRUSTED_PROXIES=172.30.0.2         # proxy container with a fixed address
TRUSTED_PROXIES=10.0.0.5           # proxy on another machine
```

**When the default is fine:** when nothing but the proxy can reach Punchlist at all. In
[`compose.caddy.yaml`](docker-compose.md#with-https-caddy) Punchlist has no published port and
shares its network with Caddy only, so there is no one else to believe. Setting it anyway costs
nothing.

**Caddy behind something else** (Cloudflare, Pangolin, a load balancer): Caddy ignores the
`X-Forwarded-For` it is sent unless told to trust the hop in front of it, so every request would be
logged as coming from that hop. Tell Caddy with its global
[`trusted_proxies`](https://caddyserver.com/docs/caddyfile/options#trusted-proxies) option, and
keep Punchlist's `TRUSTED_PROXIES` on Caddy.

## Caddy

The recommended Caddyfile. Caddy gets and renews the certificate itself and redirects `http` to
`https`:

```text title="Caddyfile"
--8<-- "examples/reverse-proxy/Caddyfile"
```

What each part is for, and whether you need it:

| Part                                         | Needed?     | Why                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks.example.com { reverse_proxy ... }`    | Yes         | The certificate, the redirect to HTTPS and the forwarded headers all come with it.                                                                                                                                                                                                                   |
| `encode zstd gzip`                           | Recommended | Punchlist sends nothing compressed. Compressed, the app's script goes from 1.5 MB to under 0.5 MB and sync answers shrink by more than half, which saves seconds on a first sign-in over a slow connection. Caddy leaves the live-update stream uncompressed, so updates are not delayed.            |
| `header { ... }`                             | Recommended | Browser protections Punchlist does not send itself yet. See [security headers](#security-headers).                                                                                                                                                                                                    |
| `flush_interval -1` (older examples)         | No          | Caddy already sends server-sent events at once. Harmless if you have it.                                                                                                                                                                                                                              |
| `request_body max_size`                      | No          | Caddy has no upload limit unless you set one. If you do, allow at least 200 MB for backups.                                                                                                                                                                                                           |
| `header_up X-Forwarded-*`, `header_up Host`  | No          | Caddy sets `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`, and passes `Host` on, by itself.                                                                                                                                                                                            |

A whole Compose setup with Caddy is in [Docker Compose](docker-compose.md#with-https-caddy).

## Security headers

Punchlist does not set browser security headers on its pages yet, so let the proxy add them. None
of them is needed for Punchlist to work; each closes a door that is cheap to close.

| Header                            | Needed?     | Why                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security`       | Recommended | Browsers that have been to the site once go straight to `https` from then on, even when someone types or links `http://`, so nobody on the way can catch a first plain request. Add it once HTTPS works: browsers then refuse plain `http` on that name for a year. Leave out `preload` unless you mean to submit the domain to the browsers' preload list. |
| `X-Frame-Options: DENY`           | Recommended | No other site can show Punchlist inside a frame, so nobody can trick a signed-in admin into clicking buttons on a hidden copy of the admin pages ("clickjacking"). Neither the web app nor the Android app frames it.                                                                                                                     |
| `X-Content-Type-Options: nosniff` | Recommended | Browsers take the content type the server gives instead of guessing, so a file cannot be run as a script or page. Attachments already send it; this covers everything else.                                                                                                                                                              |
| `Referrer-Policy: same-origin`    | Recommended | When someone follows a link in a task's notes, the other site does not learn your server's address or which page they came from.                                                                                                                                                                                                         |
| `Content-Security-Policy`         | Optional    | Limits where the page may load scripts, styles, images and connections from: if a bug ever let someone inject script, it could not pull in more from elsewhere or send your data away. It needs care, see below.                                                                                                                        |
| `-Server`                         | No          | Hides that the proxy is Caddy. Cosmetic: it does not make anything harder to attack.                                                                                                                                                                                                                                                     |
| `X-XSS-Protection`, `Expect-CT`   | No          | Obsolete; current browsers ignore them. Do not add them.                                                                                                                                                                                                                                                                                  |

**About the Content-Security-Policy:**

- The policy in the example is the strictest one the app runs with today. It was checked in Chrome:
  signing in, adding and completing tasks, live sync between two devices, and the service worker,
  with nothing blocked. It allows `'unsafe-eval'` because the app builds its data checks at run
  time, and inline styles because its components set styles that way. Without `'unsafe-eval'` the
  app does not start.
- Set it with `?` (`?Content-Security-Policy`) in Caddy. Punchlist sends its own, stricter policy on
  attachments and provider icons, and `?` only adds the header where there is none. A plain
  `Content-Security-Policy` would replace those.
- The Android app adds its bridge as a document-start script, which a page's policy does not block
  on current Android WebViews. If the app misbehaves on an old phone, take the policy out first.
- If something stops working after you add it, open the browser's console: blocked loads are listed
  there. Removing the line rules it out.

In nginx the same headers go in the `server` block as `add_header Name "value" always;`. nginx adds
its policy next to Punchlist's on attachments instead of replacing it; browsers then apply both,
which is fine.

## nginx

```nginx title="/etc/nginx/conf.d/punchlist.conf"
--8<-- "examples/reverse-proxy/nginx.conf"
```

nginx does not compress proxied answers unless told to. Add
`gzip on; gzip_proxied any; gzip_types application/json application/javascript text/css image/svg+xml;`
for the same gain as Caddy's `encode`, and keep `text/event-stream` out of `gzip_types`.

## Traefik

Labels for a Traefik v3 that watches Docker:

```yaml
--8<-- "examples/docker/compose.traefik.yaml"
```

Traefik streams responses by default; nothing extra is needed for `/api/events`. Its `compress`
middleware gives compression and a `headers` middleware the security headers above.

## Apache

```apache
--8<-- "examples/reverse-proxy/apache.conf"
```

## Others

- **Nginx Proxy Manager**: add a proxy host to `punchlist:8080`, turn on _Websockets support_ (it
  also turns off buffering), and request a certificate.
- **Cloudflare Tunnel**: point the tunnel's public hostname at `http://punchlist:8080`. Cloudflare's
  edge may hold server-sent events back; the app still syncs every 30 seconds and whenever it comes
  back into focus, so changes arrive, just not instantly.
- **Pangolin, Authelia or Authentik forward auth**: fine in front of Punchlist, but keep
  `/api/*` and `/auth/*` reachable for the app's own sign-in and sync, or sign in only through the
  proxy and use `AUTH_MODE=none` (everyone the proxy lets through is the same one user).
