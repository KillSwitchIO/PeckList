# Reverse proxy and HTTPS

Run Punchlist behind a reverse proxy that handles HTTPS. Browsers only install the app, keep it
working offline and allow its service worker on a secure address (HTTPS, or `localhost`), so HTTPS
is not optional for real use.

## What the proxy must do

1. **Forward everything** to Punchlist's port (8080), on one host name, at the root path. Serving it
   under a sub-path (`example.com/tasks`) is not supported.
2. **Pass `X-Forwarded-For` and `X-Forwarded-Proto`**, so the server knows people's real addresses
   (for the access log and the login limits) and that the page was loaded over HTTPS.
3. **Not buffer `/api/events`**: live updates arrive over a long-lived
   [server-sent events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) stream. A
   buffering proxy delays every update until the buffer fills.
4. **Allow large uploads** (200 MB is plenty) for restoring backups through the admin page.

Then set [`PUBLIC_URL`](../configuration/reference.md#public_url) to the HTTPS address.

## Trusted proxies

The server believes `X-Forwarded-*` headers only from addresses in
[`TRUSTED_PROXIES`](../configuration/reference.md#trusted_proxies). The default trusts loopback and
the private ranges (10/8, 172.16/12, 192.168/16, fc00::/7), which covers a proxy on the same host or
Docker network. If your proxy reaches Punchlist from a public address, or you want to trust only the
proxy, list it: `TRUSTED_PROXIES=10.0.0.5` or `TRUSTED_PROXIES=10.0.0.0/24`.

## Caddy

```text title="Caddyfile"
--8<-- "examples/reverse-proxy/Caddyfile"
```

Caddy gets the certificate itself. A whole Compose setup with Caddy is in
[Docker Compose](docker-compose.md#with-https-caddy).

## nginx

```nginx title="/etc/nginx/conf.d/punchlist.conf"
--8<-- "examples/reverse-proxy/nginx.conf"
```

## Traefik

Labels for a Traefik v3 that watches Docker:

```yaml
--8<-- "examples/docker/compose.traefik.yaml"
```

Traefik streams responses by default; nothing extra is needed for `/api/events`.

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
