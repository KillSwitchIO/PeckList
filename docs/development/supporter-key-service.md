# Supporter key service

[Supporter keys](../about/support.md#supporter-keys) are bought on pecklist.com, by card through
Paddle (the merchant of record) or in Bitcoin through a BTCPay Server store. The supporter key
service is the small service the project runs to turn a paid order into signed keys and email them.
A PeckList server never runs it, and nobody self-hosting PeckList needs it: servers check keys
offline, against the public key they ship with.

Donations (Ko-fi, PayPal, and Bitcoin given as a tip rather than for a key) never pass through it
and never make a key.

The code is `server/src/PeckList.Keys`. The key format, and the check servers run, live in
`server/src/PeckList.Core/Supporters` and `server/src/PeckList.Server/Supporters`.

## The key

`PECKLIST-20261111-S-XXXXX-XXXXX-...`: the product, the purchase date (UTC), the kind (`S` one person,
`V` a server), then base32 of the format version, an 8-byte random serial and an Ed25519 signature
over everything before it, the readable start included. Editing the date or the kind breaks the
signature. The serial says nothing about the buyer, and a key looks the same whichever way it was
paid for.

## Order sources

Each way to pay is an order source (`IOrderSource` in `OrderSources.cs`): it checks a webhook's
signature, reads a paid order out of it (the provider, its order id, how many keys of each kind, the
day), and finds the buyer's email when the mail goes out. Paddle (`Paddle.cs`) and BTCPay
(`BtcPay.cs`) are the two. Each is set up by its own settings, and either or both may be; one that
isn't set up has no webhook. A new provider is a new `IOrderSource` that passes
`OrderSourceContract` in the tests, against a stand-in that sends real signed webhooks.

## How an order becomes keys

1. The provider calls `POST /api/public/<provider>/webhook`. A missing or wrong signature is refused
   with `401`.
2. The source reads the order. Each paid supporter item becomes keys of its kind, dated the day the
   order was paid. Other events and other products (donations among them) are answered `200` and
   ignored, so the provider stops retrying. If the provider's API can't be reached to read the
   order, the answer is `503` and the provider tries again later.
3. The keys are stored by the provider, its order id and their place in the order. A repeated
   webhook finds the same keys: an order is issued once.
4. The keys are emailed. The buyer's email is asked of the provider's API when the mail goes out and
   never stored. Mail that fails is tried again every few minutes, up to 100 times.
5. The website's thank-you page can show the keys for a week from
   `GET /api/public/thanks/<provider>/<order id>`: `202` while the order is still on its way, `200`
   with the keys, `404` after a week. Only the website's origin may call it from a page. An id no
   order has is also `202` (so the lookup never says which orders exist), so the page should stop
   asking after a few minutes and point to the email instead.
6. A refund does not take a key back. Keys are checked offline and never expire; there is nothing to
   withdraw one from.

Nothing about the buyer is kept: no email, name, address, card or wallet. The database holds the
provider and its order id, the keys, and when they were emailed. The handle used to find the buyer's
email (Paddle's customer id, or the BTCPay invoice id) is kept only until the mail has gone out or
been given up on, then cleared.

### Paddle

- Paddle sends `transaction.completed`. The service checks the `Paddle-Signature` header (HMAC-SHA256
  of `ts:body` with the notification destination's secret, within five minutes of its time).
- Each order line whose price is one of the supporter prices (`PADDLE_PRICE_PERSON`,
  `PADDLE_PRICE_SERVER`) becomes that many keys, dated by `billed_at`.
- The email comes from Paddle's customers API, with an API key that has `customer.read`.
- The order id is the transaction id (`txn_...`), which Paddle hands the checkout's success page.
  The older `GET /api/public/thanks/<txn_id>` still answers for Paddle orders.

### BTCPay Server

- Sell the keys as items of a Point of Sale app in the store, in its **product list** view (one
  item per invoice), with item codes such as `supporter-person` and `supporter-server`
  (`BTCPAY_ITEM_PERSON`, `BTCPAY_ITEM_SERVER`). The cart view puts the items in `posData` instead of
  `itemCode`, so its invoices get no key; the service logs each settled invoice that has no item
  code. Have the checkout ask for the buyer's email, so it lands in the invoice's `buyerEmail`.
- Set the store's invoice speed policy (in its payment settings, how many confirmations an invoice
  needs before it counts as settled) to **Medium** (one confirmation) or slower. **High** counts an
  unconfirmed on-chain payment as settled, so a double spend could still get a key. Lightning
  payments settle at once either way.
- Add a store webhook for **An invoice has been settled** (`InvoiceSettled`) pointing at
  `/api/public/btcpay/webhook`, with a secret. The service checks the `BTCPay-Sig` header (`sha256=`
  and the HMAC-SHA256 of the body with that secret). The header has no time in it, so a replayed
  webhook is only a repeat, which issues nothing new.
- The webhook only says which invoice to look at. The service then reads the invoice from the
  Greenfield API (an API key with `btcpay.store.canviewinvoices` for that store) and issues a key
  only when the invoice is `Settled`, belongs to the store (`BTCPAY_STORE_ID`), is for a supporter
  item, and paid at least the item's price (`BTCPAY_PRICE_PERSON`, `BTCPAY_PRICE_SERVER`) in the
  store's currency (`BTCPAY_CURRENCY`). Anything else, a tip or donation among them, makes no key.
- The key is dated the day the invoice settled. The email comes from the invoice's `buyerEmail`.
- The order id is the invoice id. Set the app's redirect after payment to the thank-you page with
  the invoice id in it, for example `https://pecklist.com/thanks/?btcpay={InvoiceId}`, and have the
  page look up `/api/public/thanks/btcpay/<invoice id>`.
- The service only reads invoices. It holds no wallet, and nothing about the store's wallet or keys
  belongs anywhere near it.

## Endpoints

| Endpoint                                      | What it does                                           |
| --------------------------------------------- | ------------------------------------------------------ |
| `POST /api/public/paddle/webhook`             | Paddle's notifications, when Paddle is set up.         |
| `POST /api/public/btcpay/webhook`             | BTCPay's store webhook, when BTCPay is set up.         |
| `GET /api/public/thanks/{provider}/{orderId}` | An order's keys, for the thank-you page.               |
| `GET /api/public/thanks/{transactionId}`      | The same for a Paddle transaction (the older address). |
| `GET /api/private/healthz`                    | `ok` when it is up.                                    |

Webhooks take 256 KB at most, 120 a minute a caller; the thank-you lookups 30 a minute a caller.
Publish only `/api/public/*` to the internet, through a TLS proxy; Paddle and the BTCPay server
must reach the webhooks. Keep `/api/private/healthz` off the internet.

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
port. The providers and the thank-you page cannot sign in, so the tunnel's route must not ask for a
sign-in, and it should carry only `/api/public/*`.

When the BTCPay server and the key service share a host or a private network, the webhook can go
straight to the service's private address instead of out and back through the proxy, and the
service can read invoices from BTCPay's private address (`BTCPAY_URL`).

## The thank-you page

The website's thank-you page has the order id in its address, and that id is the one handle to an
order's keys. Serve the page with `Referrer-Policy: no-referrer` and no third-party scripts, so the
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
`public-key` prints the public half again from the file. One signing key signs the keys from every
order source.

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
`BTCPAY_WEBHOOK_SECRET_FILE`, `BTCPAY_API_KEY_FILE`, `SMTP_PASSWORD_FILE`). Set up Paddle, BTCPay
or both; the service refuses to start with neither, and names any setting a provider is missing.

- **Paddle** is set up by `PADDLE_WEBHOOK_SECRET_FILE`. `PADDLE_ENVIRONMENT` is `sandbox` until the
  store goes live; the price ids (`PADDLE_PRICE_PERSON`, `PADDLE_PRICE_SERVER`) come from Paddle's
  catalog, sandbox and live separately.
- **BTCPay** is set up by `BTCPAY_URL`, with `BTCPAY_STORE_ID`, the item codes, the currency and
  the prices beside it. The two kinds' item codes must differ.

`PADDLE_API_URL` and `BTCPAY_URL` may be plain http only on this machine or a private network
(a container name such as `http://btcpay:49392`, a private address, or a `.internal`, `.local`,
`.lan` or `.home.arpa` name): anywhere else the service still starts, but warns that the API key
crosses the network unencrypted.

`KEYS_TRUSTED_PROXIES` names the TLS proxy (see above). `SMTP_TLS=none` with a user is refused
unless the mail server is on the same host, so the password never crosses a network in clear. Keep
`/data` on a volume the image's user (uid 1654) can write. A database from before BTCPay was added
is moved to the new layout on start, its orders counted as Paddle's.

`server/src/PeckList.Keys/compose.example.yaml` is a compose service to start from: no published
port, a read-only container, the signing key in its own volume and the other secrets as files. Its
health check runs `pecklist-keys healthcheck`, which asks `/api/private/healthz` on loopback (the
image has no shell or curl). CI builds the image when the service or the key format changes
(`keys-image`) and pushes `:edge` and `:sha-<commit>` from `main`.

## Testing it

`server/tests/PeckList.Keys.Tests` runs both sources against stand-ins (`Fakes.cs`) that sign their
webhooks the way the real providers do and answer the API calls the service makes. To try the
whole path by hand, run the image with `PADDLE_API_URL` and `BTCPAY_URL` pointing at a stand-in
like those, send it signed webhooks, and enter the keys it issues on a PeckList server built with
its public half in `BuiltIn` (never committed: the release guard refuses it). A server built
without that half refuses the same keys as not issued by PeckList.
