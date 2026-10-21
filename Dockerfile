# syntax=docker/dockerfile:1
# One image: the PWA build served by the ASP.NET Core server (ADR-0002). Runs as non-root on a
# chiseled base (no shell, no package manager). Data lives in the /data volume.

FROM node:24-bookworm-slim AS web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter "@punchlist/web..."
COPY schema schema
COPY web web
RUN pnpm --filter @punchlist/web build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS server
WORKDIR /src
COPY server/global.json server/Directory.Build.props server/Directory.Packages.props ./
COPY server/src/Punchlist.Core/Punchlist.Core.csproj src/Punchlist.Core/
COPY server/src/Punchlist.Server/Punchlist.Server.csproj src/Punchlist.Server/
RUN dotnet restore src/Punchlist.Server/Punchlist.Server.csproj
COPY server/src src
RUN dotnet publish src/Punchlist.Server/Punchlist.Server.csproj -c Release -o /app --no-restore \
    && mkdir -p /data && chown 1654:1654 /data

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled
WORKDIR /app
COPY --from=server /app .
COPY --from=web /src/web/dist wwwroot
# The chiseled image has no shell to create the volume's folder, so it comes over owned by the
# image's non-root user (uid 1654, "app").
COPY --from=server --chown=1654:1654 /data /data
ENV ASPNETCORE_HTTP_PORTS=8080 \
    DB_PATH=/data/punchlist.db
VOLUME /data
EXPOSE 8080
USER 1654
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD ["dotnet", "Punchlist.Server.dll", "healthcheck"]
ENTRYPOINT ["dotnet", "Punchlist.Server.dll"]
