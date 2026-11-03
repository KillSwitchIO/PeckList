# Linux (without Docker)

Each [release](https://gitlab.com/killswitch10/pecklist/-/releases) has a self-contained download
for **x64** and **arm64**: the server with everything it needs built in. No .NET, Node or database
server to install.

## Install as a service

On any systemd distribution (Debian, Ubuntu, Fedora, Arch, ...):

```bash
ARCH=x64   # or arm64
BASE=https://gitlab.com/killswitch10/pecklist/-/releases/permalink/latest/downloads
curl -LO "$BASE/pecklist-linux-$ARCH.tar.gz"
curl -LO "$BASE/SHA256SUMS"
sha256sum --check --ignore-missing SHA256SUMS
tar -xzf "pecklist-linux-$ARCH.tar.gz"
sudo "pecklist-linux-$ARCH/examples/install.sh"
sudo journalctl -u pecklist   # the first admin password, printed once
```

That takes the newest release. For a particular one, download the files from its
[release page](https://gitlab.com/killswitch10/pecklist/-/releases) instead.

The install script:

| Path                                    | What                                                             | On upgrade |
| --------------------------------------- | ---------------------------------------------------------------- | ---------- |
| `/opt/pecklist`                        | The program                                                      | Replaced   |
| `/etc/pecklist/pecklist.conf`         | Your settings ([settings file](../configuration/config-file.md)) | Kept       |
| `/var/lib/pecklist`                    | Database, snapshots, logs                                        | Kept       |
| `/etc/systemd/system/pecklist.service` | The service                                                      | Replaced   |

It makes a `pecklist` system user, and the service runs as that user with systemd's sandboxing on:
it can write only `/var/lib/pecklist`.

```ini title="pecklist.service"
--8<-- "examples/linux/pecklist.service"
```

The server listens on port **8080** on all addresses. Put it behind a
[reverse proxy](reverse-proxy.md) for HTTPS, or change the port with an override:

```bash
sudo systemctl edit pecklist
# [Service]
# Environment=ASPNETCORE_HTTP_PORTS=9000
```

## Day to day

```bash
sudo systemctl status pecklist
sudo journalctl -u pecklist -f                     # logs
sudo systemctl restart pecklist                    # after editing /etc/pecklist/pecklist.conf
sudo -u pecklist env DB_PATH=/var/lib/pecklist/pecklist.db CONFIG_FILE=/etc/pecklist/pecklist.conf \
  /opt/pecklist/pecklist snapshot                 # any CLI command, as the service user
```

The CLI must see the same `DB_PATH` (and `CONFIG_FILE`) as the service. A small wrapper saves
typing:

```bash
sudo tee /usr/local/bin/pecklist >/dev/null <<'EOF'
#!/bin/sh
exec sudo -u pecklist env DB_PATH=/var/lib/pecklist/pecklist.db \
  CONFIG_FILE=/etc/pecklist/pecklist.conf /opt/pecklist/pecklist "$@"
EOF
sudo chmod +x /usr/local/bin/pecklist
pecklist --version
```

## Upgrade

Run the newer download's `install.sh` the same way. It stops the service, swaps the program and
starts it again; the database is upgraded on start. Read [upgrading](../guides/upgrading.md) first.

## Run it by hand

No systemd, or just trying it? The program runs from the unpacked folder:

```bash
cd pecklist-linux-x64
ASPNETCORE_HTTP_PORTS=8080 ./pecklist
```

Without `DB_PATH`, the data goes to `./data` in the current folder.

## Uninstall

```bash
sudo systemctl disable --now pecklist
sudo rm -rf /opt/pecklist /etc/systemd/system/pecklist.service
sudo systemctl daemon-reload
# and when you are sure (this is your data):
sudo rm -rf /var/lib/pecklist /etc/pecklist && sudo userdel pecklist
```
