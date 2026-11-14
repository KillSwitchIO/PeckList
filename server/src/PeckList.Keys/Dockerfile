# syntax=docker/dockerfile:1
# The supporter key service (PL-112), its own small image. Build from server/:
#   docker build -f src/PeckList.Keys/Dockerfile -t pecklist-keys server
# Settings are in src/PeckList.Keys/KeySettings.cs; keep /data (the issued keys) on a volume. It listens on 8080.

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG TARGETARCH
WORKDIR /src
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY src/PeckList.Core/PeckList.Core.csproj src/PeckList.Core/
COPY src/PeckList.Keys/PeckList.Keys.csproj src/PeckList.Keys/
RUN dotnet restore src/PeckList.Keys/PeckList.Keys.csproj -a $TARGETARCH
COPY src/PeckList.Core src/PeckList.Core
COPY src/PeckList.Keys src/PeckList.Keys
RUN dotnet publish src/PeckList.Keys/PeckList.Keys.csproj -c Release -a $TARGETARCH --self-contained false \
    -o /app --no-restore
# The image has no shell to make these at run time. A new named volume takes over the folder's owner,
# so /data and /secrets volumes start out writable by the app user (1654).
RUN mkdir -p /folders/data /folders/secrets

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled
LABEL org.opencontainers.image.title="PeckList supporter key service" \
      org.opencontainers.image.source="https://gitlab.com/killswitch10/pecklist"
WORKDIR /app
COPY --from=build /app .
COPY --from=build --chown=1654:1654 /folders/data /data
COPY --from=build --chown=1654:1654 /folders/secrets /secrets
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "pecklist-keys.dll"]
