# From source

For development, or a platform without a download (macOS, Linux on another architecture).

## Needs

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js 24](https://nodejs.org/) with pnpm (`corepack enable`)
- git

[mise](https://mise.jdx.dev/) installs the exact versions from `mise.toml`: `mise install`.

## Build and run

```bash
git clone https://gitlab.com/killswitch10/punchlist.git
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
scripts/package.sh 0.0.0-local osx-arm64     # writes dist/pecklist-osx-arm64.tar.gz
```

## The image

```bash
docker build -t pecklist:local .
```

Developing on PeckList itself (tests, dev servers, conventions): see
[developing](../development/index.md).
