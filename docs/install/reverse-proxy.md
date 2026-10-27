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
`https`; Punchlist sends its own security headers and compressed answers, so nothing else is
needed:

```text title="Caddyfile"
--8<-- "examples/reverse-proxy/Caddyfile"
```

What people often add, and whether you need it:

| Part                                        | Needed? | Why                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks.example.com { reverse_proxy ... }`   | Yes     | The certificate, the redirect to HTTPS and the forwarded headers all come with it.                                                                                                                                                                              |
| `encode zstd gzip`                          | No      | Punchlist compresses its answers itself, and its app files come compressed from the build at the highest setting: smaller (216 KB for the app's main script) than Caddy compressing them on the fly (about 267 KB). Harmless: Caddy leaves compressed answers alone. |
| `header { ... }` security headers           | No      | Punchlist sends them itself, see [security headers](#security-headers). Harmless if you keep yours, with one exception: never set `Content-Security-Policy` without the `?` in front, or yours replaces Punchlist's.                                         |
| `flush_interval -1`                         | No      | Caddy already sends server-sent events at once.                                                                                                                                                                                                                 |
| `request_body max_size`                     | No      | Caddy has no upload limit unless you set one. If you do, allow at least 200 MB for backups.                                                                                                                                                                     |
| `header_up X-Forwarded-*`, `header_up Host` | No      | Caddy sets `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`, and passes `Host` on, by itself.                                                                                                                                                      |

A whole Compose setup with Caddy is in [Docker Compose](docker-compose.md#with-https-caddy).

On Punchlist 0.2.2 or older, which sent neither, add `encode zstd gzip` and the security headers
below to the site block.

## Security headers

Punchlist sets these on every answer itself, so they protect you with any proxy, or none. They are
listed here so you know what they do, and so you do not need to add them at the proxy:

| Header                            | Why                                                                                                                                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`         | The page may load scripts, styles, images and connections only from your server: if a bug ever let someone inject script, it could not pull in more from elsewhere or send your data away. Attachments and provider icons get a stricter, sandboxed policy of their own. |
| `Strict-Transport-Security`       | Browsers that have been to the site over HTTPS go straight to `https` for a year, even when someone types or links `http://`, so nobody on the way can catch a first plain request. Sent only on HTTPS requests and never for `localhost`.                                 |
| `X-Frame-Options: DENY`           | No other site can show Punchlist inside a frame, so nobody can trick a signed-in admin into clicking buttons on a hidden copy of the admin pages ("clickjacking"). The policy's `frame-ancestors 'none'` says the same to current browsers.                               |
| `X-Content-Type-Options: nosniff` | Browsers take the content type the server gives instead of guessing, so a file cannot be run as a script or page.                                                                                                                                                         |
| `Referrer-Policy: same-origin`    | When someone follows a link in a task's notes, the other site does not learn your server's address or which page they came from.                                                                                                                                           |

**HSTS needs the proxy to say HTTPS.** Punchlist knows a request came over HTTPS from the proxy's
`X-Forwarded-Proto`, which it believes only from [trusted proxies](#trusted-proxies). With the
proxy left out of `TRUSTED_PROXIES`, the header is not sent.

**Not needed, whatever guides say:** hiding the `Server` header (cosmetic, it makes nothing harder
to attack), `X-XSS-Protection` and `Expect-CT` (obsolete, current browsers ignore them), and HSTS
`preload` (it puts your domain on a list built into browsers that is slow to get off).

**If something you add needs more** (a browser extension that injects script is the usual case),
the browser's console lists what the policy blocked. The proxy can drop Punchlist's policy as a last
resort, in Caddy with `header -Content-Security-Policy`, at the cost of the protection above.

## nginx

```nginx title="/etc/nginx/conf.d/punchlist.conf"
--8<-- "examples/reverse-proxy/nginx.conf"
```

Compression and security headers come from Punchlist; nginx needs no `gzip` or `add_header`
lines for them.

## Traefik

Labels for a Traefik v3 that watches Docker:

```yaml
--8<-- "examples/docker/compose.traefik.yaml"
```

Traefik streams responses by default; nothing extra is needed for `/api/events`, and no `compress`
or `headers` middleware either.

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
