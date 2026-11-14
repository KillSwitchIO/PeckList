# Fedora, RHEL and openSUSE

Each [release](https://gitlab.com/killswitch10/pecklist/-/releases) has `.rpm` packages for
**x86_64** and **aarch64**, for current Fedora, RHEL 9 or later and its rebuilds (AlmaLinux, Rocky
Linux), and openSUSE Leap and Tumbleweed:

- `pecklist` is the server, run by systemd as its own `pecklist` user. It has everything it needs
  built in: no .NET, Node or database server to install.
- `pecklist-cli` is the [command line](../reference/cli.md), `pecklist`, for any machine that
  talks to a server. It comes with shell completion for bash, zsh and fish.

## Install

From PeckList's RPM repository, so `dnf upgrade` (or `zypper update`) brings each new release:

```bash
# Fedora and RHEL:
sudo curl -fsSLo /etc/yum.repos.d/pecklist.repo https://packages.pecklist.com/pecklist.repo
sudo dnf install pecklist pecklist-cli
# openSUSE:
sudo rpm --import https://packages.pecklist.com/pecklist.asc
sudo zypper addrepo https://packages.pecklist.com/pecklist.repo
sudo zypper install pecklist pecklist-cli

sudo systemctl enable --now pecklist
sudo journalctl -u pecklist   # the first admin password, printed once
```

As with other packages on these systems, the service is not started on install: the
`systemctl enable --now` line starts it, and starts it again at boot. The repository holds final
releases only (no release candidates); it and every package in it are signed with the "PeckList
Packages" key. The first install asks you to accept it: say yes only when the fingerprint it
shows is this one (or check it first):

```bash
curl -fsSL https://packages.pecklist.com/pecklist.asc | gpg --show-keys
# must show: 4E73 5C40 1542 41D2 4730  CE84 75B8 11D0 46A9 A3DF
```

For the command line alone, install only `pecklist-cli`.

Or download the packages and install them, with no repository:

```bash
ARCH=$(uname -m)   # x86_64 or aarch64
BASE=https://gitlab.com/killswitch10/pecklist/-/releases/permalink/latest/downloads
curl -LO "$BASE/pecklist.$ARCH.rpm" -LO "$BASE/pecklist-cli.$ARCH.rpm" -LO "$BASE/SHA256SUMS"
sha256sum --check --ignore-missing SHA256SUMS
sudo dnf install "./pecklist.$ARCH.rpm" "./pecklist-cli.$ARCH.rpm"
# openSUSE: sudo zypper install --allow-unsigned-rpm "./pecklist.$ARCH.rpm" "./pecklist-cli.$ARCH.rpm"
```

That takes the newest release. For a particular one, download the files from its
[release page](https://gitlab.com/killswitch10/pecklist/-/releases) instead. Downloaded packages are
not signed themselves; `SHA256SUMS` is what checks them.

The members of the `adm`, `wheel` and `systemd-journal` groups can read the journal, and so the
first admin password too. PeckList asks for a new one at the first sign-in, so sign in soon after
installing.

The server listens on port **8080** on all addresses. Put it behind a
[reverse proxy](reverse-proxy.md) for HTTPS, and open the port in the firewall if other machines
reach it directly: `sudo firewall-cmd --add-port=8080/tcp --permanent && sudo firewall-cmd --reload`.

| Path                          | What                                                             | Kept on upgrade | Kept on remove |
| ----------------------------- | ---------------------------------------------------------------- | --------------- | -------------- |
| `/usr/lib/pecklist`           | The program and the web app                                      | Replaced        | No             |
| `/etc/pecklist/pecklist.conf` | Your settings ([settings file](../configuration/config-file.md)) | Yes             | Yes            |
| `/etc/pecklist/pecklist.env`  | Settings read from the environment only: the port, `DB_PATH`     | Yes             | If edited (as `.rpmsave`) |
| `/var/lib/pecklist`           | The database, snapshots and logs                                 | Yes             | Yes            |

The service runs with systemd's sandboxing on: it can write only `/var/lib/pecklist`.

## Day to day

```bash
sudo systemctl status pecklist
sudo journalctl -u pecklist -f        # logs
sudo systemctl restart pecklist       # after editing a file in /etc/pecklist
sudo pecklist-server snapshot         # any maintenance command, as the service user
sudo pecklist-server help             # the list of them
```

`pecklist-server` runs the [maintenance commands](../reference/cli.md) with the service's own
settings, so it always works on the same database as the running server.

To use another port, set `ASPNETCORE_HTTP_PORTS` in `/etc/pecklist/pecklist.env`, then restart.

## Upgrade

With the repository, `sudo dnf upgrade` (or `sudo zypper update`). Without it, download the newer
packages and install them the same way. Read [upgrading](../guides/upgrading.md) first. The package takes a snapshot of the database before it
replaces the program, restarts a running server, and the server upgrades the database on start. If
the snapshot fails, nothing is changed and the reason is printed.

## Moving from the archive download

Installing the package over an install made with the archive's `install.sh` (in `/opt/pecklist`)
takes it over: the package removes `/opt/pecklist` and the old unit, keeps your settings and data,
and starts the server again if it was running. A port set with `systemctl edit` should move to
`/etc/pecklist/pecklist.env`.

## Remove

```bash
sudo dnf remove pecklist pecklist-cli    # or zypper remove; keeps the data and edited settings
# and when you are sure (this is your data):
sudo rm -rf /var/lib/pecklist /etc/pecklist
```
