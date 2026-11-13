# Arch Linux

PeckList is in the [AUR](https://aur.archlinux.org/) as two packages, for **x86_64** and
**aarch64**:

| Package            | What                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| `pecklist-bin`     | The server, run by systemd as the `pecklist` user                        |
| `pecklist-cli-bin` | The [command line client](../reference/cli.md#client-commands) as `pecklist` |

Both repackage the release's portable downloads, checked against the release's SHA-256 sums.
The AUR gets final releases only, never release candidates.

## Install

With an AUR helper:

```bash
yay -S pecklist-bin pecklist-cli-bin   # or paru -S ...
```

Or by hand:

```bash
git clone https://aur.archlinux.org/pecklist-bin.git
cd pecklist-bin
makepkg -si
```

Then start it and read the first admin password, printed once:

```bash
sudo systemctl enable --now pecklist
sudo journalctl -u pecklist
```

The server listens on port **8080** on all addresses. Open it, sign in as `admin` with that
password, and put it behind a [reverse proxy](reverse-proxy.md) for HTTPS.

## Where things are

The same as the [Debian and Fedora packages](debian-ubuntu.md):

| Path                                       | What                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `/etc/pecklist/pecklist.conf`              | Your settings ([settings file](../configuration/config-file.md))     |
| `/etc/pecklist/pecklist.env`               | The port and database path, read by the service and `pecklist-server` |
| `/var/lib/pecklist`                        | Database, snapshots                                                  |
| `/usr/lib/pecklist`                        | The program                                                          |
| `/usr/lib/systemd/system/pecklist.service` | The service, with systemd's sandboxing on                            |

```bash
sudo systemctl restart pecklist             # after editing a settings file
sudo pecklist-server snapshot               # maintenance commands, as the pecklist user
sudo pecklist-server admin reset-password admin
```

## Upgrade

Upgrade the package as usual (`yay -Syu`, or `git pull && makepkg -si`). Before the files change,
pacman takes a snapshot with the version you have, so there is a way back. pacman does not restart
services: the new version runs, and upgrades the database, when you restart it:

```bash
sudo systemctl restart pecklist
```

Read [upgrading](../guides/upgrading.md) before a new minor version. Your settings are kept:
`pecklist.conf` is yours from the first install on, and for an edited `pecklist.env` pacman saves
the new default beside it as `.pacnew`.

### From the download archive

Installed PeckList with the [portable download's install script](linux.md) before? The package
takes that install over: it stops and removes `/opt/pecklist` and its unit, after a snapshot, and
keeps `/etc/pecklist/pecklist.conf` and the data in `/var/lib/pecklist`. Then start it with
`sudo systemctl enable --now pecklist`. If `/opt/pecklist` holds a database (or an override in
`/etc/systemd/system/pecklist.service.d` points there), the package leaves it alone and says how to
move the data first.

## Remove

```bash
sudo pacman -R pecklist-bin pecklist-cli-bin   # keeps the data and edited settings
# and when you are sure (this is your data):
sudo rm -rf /var/lib/pecklist /etc/pecklist && sudo userdel pecklist
```
