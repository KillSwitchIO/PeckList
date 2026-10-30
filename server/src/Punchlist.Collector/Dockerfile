# syntax=docker/dockerfile:1
# The telemetry collector (PL-116), its own small image. Build from server/:
#   docker build -f src/Punchlist.Collector/Dockerfile -t punchlist-collector server
# Run with COLLECTOR_DB set to a PostgreSQL connection string; it listens on 8080.

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG TARGETARCH
WORKDIR /src
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY src/Punchlist.Core/Punchlist.Core.csproj src/Punchlist.Core/
COPY src/Punchlist.Collector/Punchlist.Collector.csproj src/Punchlist.Collector/
RUN dotnet restore src/Punchlist.Collector/Punchlist.Collector.csproj -a $TARGETARCH
COPY src/Punchlist.Core src/Punchlist.Core
COPY src/Punchlist.Collector src/Punchlist.Collector
RUN dotnet publish src/Punchlist.Collector/Punchlist.Collector.csproj -c Release -a $TARGETARCH --self-contained false \
    -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled
LABEL org.opencontainers.image.title="Punchlist telemetry collector" \
      org.opencontainers.image.source="https://gitlab.com/killswitch10/punchlist"
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "punchlist-collector.dll"]
