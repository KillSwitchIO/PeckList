# Supporter key service

[Supporter keys](../about/support.md#supporter-keys) are bought on pecklist.com through Paddle, which
acts as the merchant of record. The supporter key service is the small service the project runs to
turn a paid order into signed keys and email them. A PeckList server never runs it, and nobody
self-hosting PeckList needs it: servers check keys offline, against the public key they ship with.

The code is `server/src/PeckList.Keys`. The key format, and the check servers run, live in
`server/src/PeckList.Core/Supporters` and `server/src/PeckList.Server/Supporters`.

## The key

`PECKLIST-20261111-S-XXXXX-XXXXX-...`: the product, the purchase date (UTC), the kind (`S` one person,
`V` a server), then base32 of the format version, an 8-byte random serial and an Ed25519 signature
over everything before it, the readable start included. Editing the date or the kind breaks the
signature. The serial says nothing about the buyer.

## How an order becomes keys

1. Paddle sends `transaction.completed` to `POST /api/public/paddle/webhook`. The service checks the
   `Paddle-Signature` header (HMAC-SHA256 of `ts:body` with the notification destination's secret,
   within five minutes of its time) and refuses anything unsigned with `401`.
2. Each order line whose price is one of the supporter prices becomes that many keys, of its kind,
   dated by `billed_at`. Other events and other products are answered `200` and ignored, so Paddle
   stops retrying.
3. The keys are stored by the transaction id and their place in the order. A repeated notification
   finds the same keys: an order is issued once.
4. The keys are emailed. The buyer's email is asked of Paddle's customers API when the mail goes out
   and never stored. Mail that fails is tried again every few minutes, up to 100 times.
5. The website's thank-you page can show the keys for a week from `GET /api/public/thanks/<txn_id>`
   (the transaction id Paddle hands the checkout's success page): `202` while the order is still on
   its way, `200` with the keys, `404` after a week. Only the website's origin may call it from a page.
   An id no order has is also `202` (so the lookup never says which orders exist), so the page
   should stop asking after a few minutes and point to the email instead.
6. A refund in Paddle does not take a key back. Keys are checked offline and never expire; there
   is nothing to withdraw one from.

Nothing about the buyer is kept: no email, name, address or card. The database holds the
transaction id Paddle sends, the keys, and when they were emailed. Paddle's customer id is kept only
until the mail has gone out or been given up on, then cleared.

## Endpoints

| Endpoint                                | What it does                                                    |
| --------------------------------------- | --------------------------------------------------------------- |
| `POST /api/public/paddle/webhook`       | Paddle's notifications (256 KB at most, 120 a minute a caller).  |
| `GET /api/public/thanks/{transactionId}` | An order's keys, for the thank-you page (30 a minute a caller).  |
| `GET /api/private/healthz`              | `ok` when it is up.                                              |

Publish only `/api/public/*` to the internet, through a TLS proxy; Paddle must reach the webhook.
Keep `/api/private/healthz` off the internet.

The limits count each caller by address, and each public route also has an overall cap of 1,200 a
minute. Behind the proxy every connection comes from the proxy, so set `KEYS_TRUSTED_PROXIES` to its
address: the service then takes the caller from the proxy's `X-Forwarded-For` (the last address it
added) and trusts that header from nobody else. Without it, every caller shares one allowance. With
a CDN in front of the proxy (Cloudflare, say), the last address the proxy adds is the CDN's, so have
the proxy set `X-Forwarded-For` from the CDN's client header (`CF-Connecting-IP`); otherwise
everyone behind one CDN location shares an allowance. Simpler still, give the service a hostname
that does not go through the CDN. IPv6 callers count by their /64. The thank-you lookup's answers
say `Cache-Control: no-store`, so nothing in between keeps a key.

When the TLS proxy runs on another machine and reaches this one through a tunnel (Pangolin with
Newt, Cloudflare Tunnel, a WireGuard link to a VPS), connections come from the tunnel's end on this
host, not from the proxy. Set `KEYS_TRUSTED_PROXIES` to that address: the tunnel agent's container
address or network when it shares a Docker network with the service (give that network a fixed
subnet, as `compose.example.yaml` does), or the agent's host address when it runs on another
machine and reaches a published port. A tunnel that forwards the connection as it is keeps the
proxy's `X-Forwarded-For`. Anything else that can connect from that address could name any caller,
so keep the agent and the service alone on that network, and let nothing else reach a published
port. Paddle and the thank-you page cannot sign in, so the tunnel's route must not ask for a
sign-in, and it should carry only `/api/public/*`.

## The thank-you page

The website's thank-you page has the transaction id in its address, and that id is the one handle to
an order's keys. Serve the page with `Referrer-Policy: no-referrer` and no third-party scripts, so the
id is never sent on to anyone else.

## The signing key

Made once, on the service's host, and never shown in chat, logs or notes:

```bash
docker run --rm -v keys-secrets:/secrets registry.gitlab.com/killswitch10/pecklist/keys:edge \
  generate-signing-key /secrets/signing-key
```

It writes the private key to the file (readable by its owner only, and refuses to overwrite one)
and prints the public half. The public half goes into `SupporterKeyCheck.BuiltIn` in the server, in
a release; a new signing key is added beside the old one, so keys already sold keep working.
`public-key` prints the public half again from the file.

The same public halves go into the CI variable `SUPPORTER_PUBLIC_KEYS` (comma-separated; public
values, so neither protected nor masked). `prepare-release` and the release merge request's
`release-guard` run `scripts/supporter-keys.mjs`, which fails when `BuiltIn` holds a key that
variable does not, so a key pasted in from a test can't ship. While `BuiltIn` is empty it passes.

### Backing it up and replacing it

- **Back it up:** keep an encrypted copy of the key file offline, away from the service's host.
- **If it is lost:** make a new one and ship its public half in a release. Keys already sold keep
  working everywhere; keys signed by the new one are accepted only by servers from that release on.
- **If it leaks:** the worst anyone can do is make supporter keys that look genuine, and they unlock
  nothing. Make a new signing key, ship its public half, and keep the old half. Removing the old half
  from `SupporterKeyCheck.BuiltIn` would also take the badge from every genuine key it signed, since
  servers check stored keys again on every read. Remove it only if fake keys are actually handed
  around.

## Running it

The settings, all from the environment, are listed at the top of `KeySettings.cs`. Secrets are read
from files (`KEYS_SIGNING_KEY_FILE`, `PADDLE_WEBHOOK_SECRET_FILE`, `PADDLE_API_KEY_FILE`,
`SMTP_PASSWORD_FILE`). `PADDLE_ENVIRONMENT` is `sandbox` until the store goes live; the price ids
(`PADDLE_PRICE_PERSON`, `PADDLE_PRICE_SERVER`) come from Paddle's catalog, sandbox and live
separately. `KEYS_TRUSTED_PROXIES` names the TLS proxy (see above). `SMTP_TLS=none` with a user is
refused unless the mail server is on the same host, so the password never crosses a network in
clear. Keep `/data` on a volume the image's user (uid 1654) can write.

`server/src/PeckList.Keys/compose.example.yaml` is a compose service to start from: no published
port, a read-only container, the signing key in its own volume and the other secrets as files. Its
health check runs `pecklist-keys healthcheck`, which asks `/api/private/healthz` on loopback (the
image has no shell or curl). CI builds the image when
the service or the key format changes (`keys-image`) and pushes `:edge` and `:sha-<commit>` from
`main`.
