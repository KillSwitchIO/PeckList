# From source

For development, or a platform without a download (macOS, Linux on another architecture).

## Needs

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js 24](https://nodejs.org/) with pnpm (`corepack enable`)
- git

[mise](https://mise.jdx.dev/) installs the exact versions from `mise.toml`: `mise install`.

## Build and run

```bash
git clone https://gitlab.com/killswitch10/pecklist.git
cd pecklist
pnpm install
pnpm build                                   # the web app, into web/dist
dotnet publish server/src/PeckList.Server -c Release -o out
cp -r web/dist out/wwwroot
ASPNETCORE_HTTP_PORTS=8080 out/pecklist     # out\pecklist.exe on Windows
```

This needs the .NET runtime on the machine that runs it. For a self-contained folder like the
release downloads, use the packaging script (it takes any .NET runtime identifier, such as
`osx-arm64` or `linux-musl-x64`):

```bash
scripts/package.sh 0.0.0-local osx-arm64     # writes dist/pecklist-server-osx-arm64-portable.tar.gz
```

## The image

```bash
docker build -t pecklist:local .
```

## Running a modified version

PeckList is under the AGPL: if you change it and others use your server, offer them your source.
Settings > About PeckList links PeckList's own source; to link yours instead, set
`PECKLIST_SOURCE_URL` when you build the web app (`PECKLIST_SOURCE_URL=https://... pnpm build`), or
pass `--build-arg SOURCE_URL=https://...` to `docker build`.

Developing on PeckList itself (tests, dev servers, conventions): see
[developing](../development/index.md).
