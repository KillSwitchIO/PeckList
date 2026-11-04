# Email

The server can send email through your mail provider, a sending service, or your own mail
server: anything that takes SMTP submissions. Without email the server works as before. With it:

- people add an email to their account and confirm it, then reset a forgotten password from the
  sign-in page (**Forgot your password?**);
- admins email someone a reset link (**Admin > Users**, the person's menu, **Email a reset link**);
- invite links can go out by email (**Invite people**, **Email it to**).

## Setting it up

1. Set [`PUBLIC_URL`](../configuration/reference.md#public_url) to the address people open
   PeckList at. Links in emails are built from it, never from the address a request came in on
   (anyone can send any address), so without it nothing is sent.
2. On the admin **Settings** page, under **Email**, pick your **Provider** and fill in **Sign in
   as** and **Password** as its section below says. What the provider fills in (the mail server,
   port and encryption, and for some sending services the login name) shows its values, greyed
   out; a value saved there earlier is cleared when you save, so the provider's applies. Pick
   **Other** to set them yourself. They apply at once.
3. Type an address under **Send a test to** and press **Send test email**: it says sent, or what
   the mail server answered.

The same in the environment (any [email setting](../configuration/reference.md#email) can live
here instead of on the page):

```yaml
PUBLIC_URL: https://tasks.example.com
SMTP_PROVIDER: gmail
SMTP_USER: you@gmail.com
SMTP_PASSWORD_FILE: /run/secrets/smtp_password
```

The provider fills in the server, port and encryption; in the environment, a value you set for one
of them (`SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_USER`) wins over the provider's. When the login
is an email address (a mailbox such as Gmail), mail comes from it; set `SMTP_FROM` to send from
another address the login may use, or to change the name (`Our tasks <you@gmail.com>`).

## Mail providers

A mailbox you already have is the quickest start, and plenty for a household: each sends a few
hundred emails a day or more. Most need an **app password**: a separate password for one app,
made in the provider's security settings, which only works for mail and can be withdrawn on its
own. Your normal password does not work there.

### Gmail

1. Turn on [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification)
   for the Google account (app passwords need it).
2. Open [App passwords](https://myaccount.google.com/apppasswords), type `PeckList` as the name and
   press **Create**. Copy the 16 letters it shows (the spaces do not matter).
3. In PeckList: **Provider** Gmail (`gmail`), **Sign in as** your Gmail address, **Password** the
   app password.

Gmail sends from your own address only (or one added under Gmail's **Send mail as**); another
`SMTP_FROM` is rewritten to yours. A personal account sends up to about 500 emails a day.

### Google Workspace

The same as Gmail with your Workspace address: **Provider** Google Workspace (`google-workspace`),
**Sign in as** the address, **Password** an app password made at [App
passwords](https://myaccount.google.com/apppasswords) after turning on 2-Step Verification. If the
page says app passwords are not available, your Workspace admin has turned them off for the
organization.

For a server sending as an address nobody signs in to, a Workspace admin can set up the SMTP relay
instead: **Admin console > Apps > Google Workspace > Gmail > Routing > SMTP relay service**,
allowing **Only addresses in my domains**, with **Require SMTP Authentication** and **Require TLS
encryption**. Then use **Provider** Other (`custom`), `SMTP_HOST: smtp-relay.gmail.com`, port 587,
and a Workspace user's address and app password as the login.

### iCloud Mail

1. Turn on two-factor authentication for the Apple Account (on by default for most).
2. At [account.apple.com](https://account.apple.com), **Sign-In and Security > App-Specific
   Passwords**, add one named `PeckList` and copy it.
3. In PeckList: **Provider** iCloud Mail (`icloud`), **Sign in as** your iCloud email address (the
   one ending in `@icloud.com`, `@me.com` or `@mac.com`, not a phone number), **Password** the
   app-specific password.

Mail can come from that address, an iCloud alias, or a custom-domain address set up in iCloud
Mail; set `SMTP_FROM` for the last two.

### Yahoo Mail

1. In [Account security](https://login.yahoo.com/account/security), choose **Generate app
   password** (or **Manage app passwords**), name it `PeckList` and copy it.
2. In PeckList: **Provider** Yahoo Mail (`yahoo`), **Sign in as** your full Yahoo address,
   **Password** the app password.

### Fastmail

1. **Settings > Privacy & Security > Manage app passwords and access > New app password**. Give it
   a name, and for access choose **SMTP** (or **Mail: IMAP, POP and SMTP**). Copy it.
2. In PeckList: **Provider** Fastmail (`fastmail`), **Sign in as** your Fastmail address,
   **Password** the app password.

Any address or alias on the account can be `SMTP_FROM`.

### Zoho Mail

1. If the account has two-factor sign-in (it should), make an app password at
   [accounts.zoho.com](https://accounts.zoho.com) under **Security > App Passwords**. Without
   two-factor sign-in, the account password works.
2. In PeckList: **Provider** Zoho Mail (`zoho`) (or Zoho Mail (EU), `zoho-eu`, for an account at
   zoho.eu), **Sign in as** your full Zoho address, **Password** the app password.

Accounts in other Zoho regions set `SMTP_HOST` to theirs as well (`smtp.zoho.in`,
`smtp.zoho.com.au`, `smtp.zoho.jp`). Zoho sends only from addresses on the account.

### Proton Mail

Proton offers SMTP for addresses on a custom domain, on its paid plans.

1. **Settings > All settings > Proton Mail > IMAP/SMTP > SMTP tokens > Generate token**, choose the
   address mail should come from, name the token `PeckList` and copy it (it shows once).
2. In PeckList: **Provider** Proton Mail (`proton`), **Sign in as** that address, **Password** the
   token.

### Outlook.com and Microsoft 365

Microsoft is turning off password sign-in for SMTP (Basic authentication) on Outlook.com and
Microsoft 365 alike: a Microsoft mailbox now wants OAuth for it, which PeckList does not do yet.
Use another mailbox above, or a sending service below, for now.

## Sending services

Sending services are built for mail from apps: they deliver well, keep logs of what went out, and
most have a free tier that covers a household server many times over. Each wants you to prove you
own the domain mail comes from, by adding the DNS records it shows you (usually SPF, DKIM and a
return-path record), and gives you an SMTP login. `SMTP_FROM` must be an address on that domain.

### SendGrid

1. **Settings > Sender Authentication**: authenticate your domain (or, to try it out, verify a
   single sender address).
2. **Settings > API Keys > Create API Key**, with **Restricted Access** and only **Mail Send** on.
   Copy the key (it shows once).
3. In PeckList: **Provider** SendGrid (`sendgrid`), **Password** the API key (the login name,
   `apikey`, is filled in), **Sent from** an address on the authenticated domain.

### Mailgun

1. **Send > Sending > Domains > Add new domain** (a subdomain such as `mg.example.com` is usual)
   and add the DNS records it lists until it shows verified.
2. In the domain's **Domain settings > SMTP credentials**, add a login (such as
   `postmaster@mg.example.com`) and copy its password.
3. In PeckList: **Provider** Mailgun (`mailgun`) (or Mailgun (EU), `mailgun-eu`, for a domain in
   Mailgun's EU region), **Sign in as** that login, **Password** its password, **Sent from** an
   address on the domain.

### Postmark

1. **Sender Signatures**: add your domain and its DNS records (or a single sender address).
2. Open your server, then **Default Transactional Stream > Setup Instructions > SMTP**: the
   username and the password are both the server's **API token**.
3. In PeckList: **Provider** Postmark (`postmark`), **Sign in as** and **Password** both that token,
   **Sent from** an address on the domain.

### Brevo

1. **Senders, Domains & Dedicated IPs > Domains**: add and authenticate your domain.
2. **SMTP & API > SMTP**: note the **Login** (an address like `1a2b3c@smtp-brevo.com`) and press
   **Generate a new SMTP key**. Copy it.
3. In PeckList: **Provider** Brevo (`brevo`), **Sign in as** the login, **Password** the SMTP key,
   **Sent from** an address on the domain.

### Resend

1. **Domains > Add Domain** and add its DNS records until it shows verified.
2. **API Keys > Create API Key**, with **Sending access** (to that domain if you like). Copy it.
3. In PeckList: **Provider** Resend (`resend`), **Password** the API key (the login name, `resend`,
   is filled in), **Sent from** an address on the domain.

### Amazon SES

1. In the SES console of your region, **Identities > Create identity**: your domain (with its DNS
   records) or one address.
2. **SMTP settings > Create SMTP credentials**. These are SMTP's own user name and password, not
   your AWS access keys. Copy both.
3. In PeckList: **Provider** Amazon SES (`amazon-ses`), **Mail server** set to your region's
   `email-smtp.<region>.amazonaws.com` when it is not `us-east-1` (the only field this provider
   leaves open), **Sign in as** and **Password**
   the SMTP credentials, **Sent from** an address of the identity.

A new SES account starts in the sandbox, sending only to addresses you verified; ask for
production access in the console to send to anyone.

## Your own mail server or a relay

**Provider** Other (`custom`) and the mail server's own details: `SMTP_HOST`, `SMTP_PORT` and
`SMTP_TLS` (`starttls` for 587, `tls` for 465). A relay on the same host or a private network
(Postfix, an SMTP relay container) often needs no login and may have no TLS: set
`SMTP_TLS: none` only there.

## When it does not work

**Send test email** shows the mail server's own answer:

- *refused the login*: the login or password is wrong, or the provider wants an app password (or,
  for a sending service, its key) instead of your normal one.
- *the TLS handshake failed*: `SMTP_TLS` does not match the port (465 is `tls`, 587 is `starttls`).
- *could not reach*: the host or port is wrong, or a firewall blocks the way out (some hosting
  providers block port 25 and sometimes 587; try 465).
- *said no*: the mail server refused the message, often because `SMTP_FROM` is not an address the
  login may send from, or its domain is not verified with the sending service yet.

Emails that arrive in spam usually mean the domain's SPF and DKIM records are missing: a mailbox
provider's own address avoids that, and sending services show you the records to add.
