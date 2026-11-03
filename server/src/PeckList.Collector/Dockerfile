# syntax=docker/dockerfile:1
# The telemetry collector (PL-116), its own small image. Build from server/:
#   docker build -f src/PeckList.Collector/Dockerfile -t pecklist-collector server
# Run with COLLECTOR_DB set to a PostgreSQL connection string; it listens on 8080.

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG TARGETARCH
WORKDIR /src
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY src/PeckList.Core/PeckList.Core.csproj src/PeckList.Core/
COPY src/PeckList.Collector/PeckList.Collector.csproj src/PeckList.Collector/
RUN dotnet restore src/PeckList.Collector/PeckList.Collector.csproj -a $TARGETARCH
COPY src/PeckList.Core src/PeckList.Core
COPY src/PeckList.Collector src/PeckList.Collector
RUN dotnet publish src/PeckList.Collector/PeckList.Collector.csproj -c Release -a $TARGETARCH --self-contained false \
    -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled
LABEL org.opencontainers.image.title="PeckList telemetry collector" \
      org.opencontainers.image.source="https://gitlab.com/killswitch10/punchlist"
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "pecklist-collector.dll"]
