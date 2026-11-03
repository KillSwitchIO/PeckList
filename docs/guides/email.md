# Email

The server can send email through any mail server that takes SMTP submissions: your own, your
mail provider's, or a sending service. Without it the server works as before; with it, people get
password reset links and invites by email (coming next in PL-122), and admins can check the setup
from the settings page.

## Setting it up

Set the [email settings](../configuration/reference.md#email) in the environment, or on the admin
**Settings** page under **Email** (they apply at once). Then type an address under **Send a test
to** and press **Send test email**: it says sent, or what the mail server answered.

```yaml
SMTP_HOST: smtp.fastmail.com
SMTP_USER: you@example.com
SMTP_PASSWORD_FILE: /run/secrets/smtp_password
SMTP_FROM: PeckList <you@example.com>
```

## Provider notes

=== "Gmail"

    `SMTP_HOST: smtp.gmail.com`, your Gmail address as `SMTP_USER`, and an
    [app password](https://myaccount.google.com/apppasswords) as `SMTP_PASSWORD` (it needs 2-step
    verification on the account). `SMTP_FROM` must be that address. Gmail limits a personal
    account to a few hundred emails a day, plenty for a household.

=== "Fastmail"

    `SMTP_HOST: smtp.fastmail.com`, your address as `SMTP_USER` and an app password (Settings >
    Privacy & Security > App passwords, with SMTP access) as `SMTP_PASSWORD`.

=== "A relay"

    A mail relay on the same host or network (Postfix, an SMTP relay container) often needs no
    login: set `SMTP_HOST`, `SMTP_PORT` and, if it has no TLS, `SMTP_TLS: none`.

=== "A sending service"

    Services such as Postmark, Resend, Mailgun or Amazon SES all take SMTP: use the host, port,
    user and password they give you, and send from an address on a domain you verified with them.

## When it does not work

**Send test email** shows the mail server's own answer:

- *refused the login*: the user or password is wrong, or the provider wants an app password.
- *the TLS handshake failed*: `SMTP_TLS` does not match the port (465 is `tls`, 587 is `starttls`).
- *could not reach*: the host or port is wrong, or a firewall blocks the way out (some hosting
  providers block port 25 and sometimes 587; try 465).
- *said no*: the mail server refused the message, often because `SMTP_FROM` is not an address the
  login may send from.
