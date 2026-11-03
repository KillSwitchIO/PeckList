# Mutual TLS (client certificates)

A reverse proxy can ask every device for a **client certificate** before it lets a request
through to PeckList: only devices you gave a certificate get as far as the sign-in page. PeckList
itself needs nothing for this (TLS ends at the proxy); browsers and the Android app answer the
proxy's request.

## The proxy

With Caddy, ask for a certificate signed by your own CA:

```caddyfile
tasks.example.com {
    tls {
        client_auth {
            mode require_and_verify
            trust_pool file /etc/caddy/client-ca.pem
        }
    }
    reverse_proxy punchlist:8080
}
```

With nginx, `ssl_client_certificate /etc/nginx/client-ca.pem;` and `ssl_verify_client on;` in the
server block. Keep `/healthz` reachable for your monitoring from inside your network (it does not
go through the proxy), or give the monitor a certificate too.

## Each device

Make a certificate for each device from your CA, and bundle it with its key as a `.p12` file
(with a password).

- **A browser**: import the `.p12` into the system's certificate store (Windows: double-click it;
  macOS: Keychain Access; Linux Firefox: Settings, Certificates). The browser asks which one to
  send the first time, then remembers.
- **The Android app**: install the `.p12` under **Settings, Security, Encryption and credentials,
  Install a certificate, VPN and app user certificate** (the wording varies by phone). When you
  connect the app to the server, it asks you to pick the certificate, and remembers it: the app,
  its background check and the buttons on its reminders all present it. Connecting to another
  server forgets it. Removing the certificate from the phone makes the app ask again.

## API keys and scripts

A script sends its certificate as well as its [API key](../reference/http-api.md#signing-in-from-a-script):

```bash
curl --cert device.pem --key device.key -H 'Authorization: Bearer pl_...' https://tasks.example.com/api/info
```

## Trouble

- **The app says the server cannot be reached**, with no certificate prompt: the certificate is
  not installed as a user certificate, or the proxy does not trust its CA. Check the proxy's log
  for the handshake.
- **A browser shows a TLS error page**: no certificate was offered. Import it, then restart the
  browser.
