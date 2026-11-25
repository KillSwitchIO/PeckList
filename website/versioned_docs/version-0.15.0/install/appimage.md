# AppImage

An AppImage is one file you download, mark as runnable and start: nothing to install and nothing
left behind when you delete it. Each [release](https://gitlab.com/killswitch10/pecklist/-/releases)
has two, for **x64** and **arm64**:

| File                                 | What                                                    |
| ------------------------------------ | ------------------------------------------------------- |
| `pecklist-server-linux-<arch>.AppImage` | The server, run in a terminal. Good for trying PeckList |
| `pecklist-cli-linux-<arch>.AppImage`    | The [command line client](../reference/cli.md#client-commands) |

For a server that stays up, use the [Debian and Ubuntu](debian-ubuntu.md) or
[Fedora, RHEL and openSUSE](fedora-rhel-opensuse.md) packages, the [portable service](linux.md)
or [Docker](docker.md): they start on boot and run as their own user. The AppImage server runs as
you, for as long as the terminal is open.

## Try the server

```bash
ARCH=x64   # or arm64
BASE=https://gitlab.com/killswitch10/pecklist/-/releases/permalink/latest/downloads
curl -LO "$BASE/pecklist-server-linux-$ARCH.AppImage"
curl -LO "$BASE/SHA256SUMS"
sha256sum --check --ignore-missing SHA256SUMS
chmod +x "pecklist-server-linux-$ARCH.AppImage"
"./pecklist-server-linux-$ARCH.AppImage"
```

`SHA256SUMS` is itself signed: [verifying downloads and images](verifying.md) checks it with cosign,
so the sums you check against came from PeckList's release pipeline.

It says where it is and prints the first admin password, once:

```text
PeckList on http://localhost:8080 (data in /home/you/.local/share/pecklist). Ctrl+C stops it.
```

Open that address and sign in as `admin`. Ctrl+C stops the server; start it again the same way
and your lists are still there. Only this computer can reach it, and the data folder is yours
alone (mode 700).

| Setting                  | Default                         | Change it with                       |
| ------------------------ | ------------------------------- | ------------------------------------ |
| Data folder              | `~/.local/share/pecklist`       | `PECKLIST_DATA=/some/folder`         |
| Address                  | `http://localhost:8080`, this computer only | `ASPNETCORE_URLS=http://localhost:9000` |
| [Settings file](../configuration/config-file.md) | `pecklist.conf` in the data folder, if it is there | `CONFIG_FILE=/some/file` |

```bash
PECKLIST_DATA=~/pecklist-test ASPNETCORE_URLS=http://localhost:9000 ./pecklist-server-linux-x64.AppImage
```

To try it from your phone, open it to the network, on a network you trust: it is plain HTTP.

```bash
ASPNETCORE_URLS=http://0.0.0.0:8080 ./pecklist-server-linux-x64.AppImage
```

`ASPNETCORE_HTTP_PORTS=9000` also works, and also listens on every address.

Any of [the settings](../configuration/reference.md) works the same way.

### Maintenance commands

The same file runs the [maintenance commands](../reference/cli.md), on the same data folder.
Stop the server first for the ones that change the database:

```bash
./pecklist-server-linux-x64.AppImage snapshot
./pecklist-server-linux-x64.AppImage admin reset-password admin
./pecklist-server-linux-x64.AppImage help
```

## The command line client

```bash
curl -LO "$BASE/pecklist-cli-linux-$ARCH.AppImage"
sha256sum --check --ignore-missing SHA256SUMS
chmod +x "pecklist-cli-linux-$ARCH.AppImage"
mkdir -p ~/.local/bin && mv "pecklist-cli-linux-$ARCH.AppImage" ~/.local/bin/pecklist
pecklist --version
```

Like the portable client it needs OpenSSL (`libssl3`) for `https://` servers, which nearly every
desktop has.

## Upgrade

Download the newer file and use it in place of the old one. The server upgrades the database when
it starts; read [upgrading](../guides/upgrading.md) first.

## No FUSE?

An AppImage mounts itself with FUSE. The FUSE library is built into these files, so all they need
is the `fusermount` helper, which most desktops have. If yours does not (the AppImage stops with a
message about FUSE), either install it (`sudo apt install fuse3` on Debian and Ubuntu,
`sudo dnf install fuse3` on Fedora) or let the AppImage unpack itself to a temporary folder each
time instead:

```bash
./pecklist-server-linux-x64.AppImage --appimage-extract-and-run
APPIMAGE_EXTRACT_AND_RUN=1 ./pecklist-server-linux-x64.AppImage   # the same, for scripts
```

Containers have no FUSE either; there, use the [Docker image](docker.md) instead.

## Remove it

Delete the AppImage files. Your data stays in `~/.local/share/pecklist` (or your `PECKLIST_DATA`)
until you delete that too.
