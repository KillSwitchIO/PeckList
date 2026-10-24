# Linux (without Docker)

Each [release](https://gitlab.com/killswitch10/punchlist/-/releases) has a self-contained download
for **x64** and **arm64**: the server with everything it needs built in. No .NET, Node or database
server to install.

## Install as a service

On any systemd distribution (Debian, Ubuntu, Fedora, Arch, ...):

```bash
ARCH=x64   # or arm64
BASE=https://gitlab.com/killswitch10/punchlist/-/releases/permalink/latest/downloads
curl -LO "$BASE/punchlist-linux-$ARCH.tar.gz"
curl -LO "$BASE/SHA256SUMS"
sha256sum --check --ignore-missing SHA256SUMS
tar -xzf "punchlist-linux-$ARCH.tar.gz"
sudo "punchlist-linux-$ARCH/examples/install.sh"
sudo journalctl -u punchlist   # the first admin password, printed once
```

That takes the newest release. For a particular one, download the files from its
[release page](https://gitlab.com/killswitch10/punchlist/-/releases) instead.

The install script:

| Path                                    | What                                                             | On upgrade |
| --------------------------------------- | ---------------------------------------------------------------- | ---------- |
| `/opt/punchlist`                        | The program                                                      | Replaced   |
| `/etc/punchlist/punchlist.conf`         | Your settings ([settings file](../configuration/config-file.md)) | Kept       |
| `/var/lib/punchlist`                    | Database, snapshots, logs                                        | Kept       |
| `/etc/systemd/system/punchlist.service` | The service                                                      | Replaced   |

It makes a `punchlist` system user, and the service runs as that user with systemd's sandboxing on:
it can write only `/var/lib/punchlist`.

```ini title="punchlist.service"
--8<-- "examples/linux/punchlist.service"
```

The server listens on port **8080** on all addresses. Put it behind a
[reverse proxy](reverse-proxy.md) for HTTPS, or change the port with an override:

```bash
sudo systemctl edit punchlist
# [Service]
# Environment=ASPNETCORE_HTTP_PORTS=9000
```

## Day to day

```bash
sudo systemctl status punchlist
sudo journalctl -u punchlist -f                     # logs
sudo systemctl restart punchlist                    # after editing /etc/punchlist/punchlist.conf
sudo -u punchlist env DB_PATH=/var/lib/punchlist/punchlist.db CONFIG_FILE=/etc/punchlist/punchlist.conf \
  /opt/punchlist/punchlist snapshot                 # any CLI command, as the service user
```

The CLI must see the same `DB_PATH` (and `CONFIG_FILE`) as the service. A small wrapper saves
typing:

```bash
sudo tee /usr/local/bin/punchlist >/dev/null <<'EOF'
#!/bin/sh
exec sudo -u punchlist env DB_PATH=/var/lib/punchlist/punchlist.db \
  CONFIG_FILE=/etc/punchlist/punchlist.conf /opt/punchlist/punchlist "$@"
EOF
sudo chmod +x /usr/local/bin/punchlist
punchlist --version
```

## Upgrade

Run the newer download's `install.sh` the same way. It stops the service, swaps the program and
starts it again; the database is upgraded on start. Read [upgrading](../guides/upgrading.md) first.

## Run it by hand

No systemd, or just trying it? The program runs from the unpacked folder:

```bash
cd punchlist-linux-x64
ASPNETCORE_HTTP_PORTS=8080 ./punchlist
```

Without `DB_PATH`, the data goes to `./data` in the current folder.

## Uninstall

```bash
sudo systemctl disable --now punchlist
sudo rm -rf /opt/punchlist /etc/systemd/system/punchlist.service
sudo systemctl daemon-reload
# and when you are sure (this is your data):
sudo rm -rf /var/lib/punchlist /etc/punchlist && sudo userdel punchlist
```
