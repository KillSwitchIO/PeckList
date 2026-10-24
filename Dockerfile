# syntax=docker/dockerfile:1
# One image: the PWA build served by the ASP.NET Core server (ADR-0002). Runs as non-root on a
# chiseled base (no shell, no package manager). Data lives in the /data volume.
#
# Multi-arch without emulation: the web and server stages always run on the build machine's own
# platform, and .NET cross-publishes for the target (-a $TARGETARCH). The final stage only copies.
#   docker buildx build --platform linux/amd64,linux/arm64 -t punchlist .
#
# Release builds pass the version: --build-arg VERSION=0.2.0 --build-arg REVISION=$(git rev-parse HEAD)
#   --build-arg CREATED=2026-10-23T00:00:00Z

ARG VERSION=0.0.0-dev
ARG REVISION=unknown
ARG CREATED=1970-01-01T00:00:00Z

FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter "@punchlist/web..."
COPY schema schema
COPY web web
ARG VERSION
ARG REVISION
RUN PUNCHLIST_VERSION="$VERSION" PUNCHLIST_REVISION="$REVISION" pnpm --filter @punchlist/web build

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS server
ARG TARGETARCH
ARG VERSION
ARG REVISION
WORKDIR /src
COPY server/global.json server/Directory.Build.props server/Directory.Packages.props ./
COPY server/src/Punchlist.Core/Punchlist.Core.csproj src/Punchlist.Core/
COPY server/src/Punchlist.Server/Punchlist.Server.csproj src/Punchlist.Server/
COPY server/src/Punchlist.Storage.Sql/Punchlist.Storage.Sql.csproj src/Punchlist.Storage.Sql/
COPY server/src/Punchlist.Storage.Sqlite/Punchlist.Storage.Sqlite.csproj src/Punchlist.Storage.Sqlite/
COPY server/src/Punchlist.Storage.Postgres/Punchlist.Storage.Postgres.csproj src/Punchlist.Storage.Postgres/
RUN dotnet restore src/Punchlist.Server/Punchlist.Server.csproj -a $TARGETARCH
COPY server/src src
# A dev build keeps the version in Directory.Build.props; a release build stamps its own.
RUN if [ "$VERSION" = "0.0.0-dev" ]; then STAMP=""; else STAMP="-p:Version=$VERSION"; fi \
    && dotnet publish src/Punchlist.Server/Punchlist.Server.csproj -c Release -a $TARGETARCH --self-contained false \
       -o /app --no-restore $STAMP -p:SourceRevisionId=$REVISION \
    && mkdir -p /data /files && chown 1654:1654 /data /files

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled
ARG VERSION
ARG REVISION
ARG CREATED
LABEL org.opencontainers.image.title="Punchlist" \
      org.opencontainers.image.description="Self-hosted, offline-first tasks and calendar" \
      org.opencontainers.image.url="https://gitlab.com/killswitch10/punchlist" \
      org.opencontainers.image.source="https://gitlab.com/killswitch10/punchlist" \
      org.opencontainers.image.documentation="https://gitlab.com/killswitch10/punchlist/-/tree/main/docs" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$REVISION" \
      org.opencontainers.image.created="$CREATED"
WORKDIR /app
COPY --from=server /app .
COPY --from=web /src/web/dist wwwroot
# The chiseled base has no time zone data, so TZ would silently mean UTC. The files are the same
# on every architecture.
COPY --from=server /usr/share/zoneinfo /usr/share/zoneinfo
# The chiseled image has no shell to create the volumes' folders, so they come over owned by the
# image's non-root user (uid 1654, "app"). Attached files get their own volume, so the bigger
# folder can live on other storage than the database.
COPY --from=server --chown=1654:1654 /data /data
COPY --from=server --chown=1654:1654 /files /files
# `punchlist` is on the PATH for the CLI: docker exec <container> punchlist export ...
ENV ASPNETCORE_HTTP_PORTS=8080 \
    DB_PATH=/data/punchlist.db \
    ATTACHMENT_DIR=/files \
    PATH=/app:$PATH
VOLUME /data /files
EXPOSE 8080
USER 1654
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD ["punchlist", "healthcheck"]
ENTRYPOINT ["punchlist"]
