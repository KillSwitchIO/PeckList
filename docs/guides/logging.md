# Logs and audit

## Logs

Every entry has the same fields wherever it goes: UTC time, level, category, message, event id,
request id, trace id, and the user's id when there is one. Passwords, cookies, tokens, secrets and
task content are never logged; a test runs the whole server at `trace` level and checks.

Where they go:

- **The console** (`docker logs`, the systemd journal), as readable `text` or `json`
  (`LOG_FORMAT`).
- **Files** in `LOG_DIR` (`/data/logs`), JSON lines. A file rolls over at midnight UTC or at
  `LOG_FILE_MAX_MB`; older files are gzipped and deleted after `LOG_FILE_KEEP_DAYS`. Turn files off
  with `LOG_FILES=false` when the console is collected anyway.
- **Log servers**, below.

Levels: `LOG_LEVEL` (default `information`), and per category with
`LOG_LEVEL_OVERRIDES=PeckList.Sync=debug,Microsoft=warning`. Levels and log servers saved in
**Admin > Settings** apply at once, without a restart. **Admin > Logs > Outputs** shows each output,
whether it keeps up, and how many entries it dropped.

## Sending logs to a log server

Set one or more. Each has its own queue of up to 10,000 entries, retried with growing waits; a log
server that is down never holds PeckList up, and what does not fit is dropped and counted.

| Stack                                                          | Settings                                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| OpenTelemetry (Grafana Alloy, OTel Collector, SigNoz, Elastic) | `LOG_OTLP_ENDPOINT=http://alloy:4318` (OTLP/HTTP, JSON), optional `LOG_OTLP_HEADERS`                  |
| Grafana Loki                                                   | `LOG_LOKI_URL=http://loki:3100`, optional `LOG_LOKI_USERNAME`, `LOG_LOKI_PASSWORD`, `LOG_LOKI_TENANT` |
| Graylog                                                        | `LOG_GELF_ADDRESS=udp://graylog:12201` (or `tcp://`, or `http://graylog:12201` for a GELF HTTP input) |
| Elasticsearch, OpenSearch (ELK)                                | `LOG_ELASTIC_URL=https://es:9200`, `LOG_ELASTIC_API_KEY` or user and password, `LOG_ELASTIC_INDEX`    |
| Syslog (rsyslog, syslog-ng, Vector)                            | `LOG_SYSLOG_ADDRESS=udp://rsyslog:514` or `tcp://...` (RFC 5424, facility local0)                     |

**Loki**: entries get the labels `service_name="punchlist"`, `host` and `level`, and each line is
the JSON entry, so every field is queryable:

```logql
{service_name="punchlist"} | json | level="error"
{service_name="punchlist"} | json | userId="01M5JR..." | line_format "{{.message}}"
```

**Elasticsearch**: entries use ECS names (`@timestamp`, `log.level`, `log.logger`, `trace.id`,
`user.id`, `http.request.id`). The default index lands in the built-in `logs-*-*` data stream, so
Kibana's Discover and Logs show them without a mapping. OpenSearch creates the index on first write.

**Graylog**: add a GELF input (UDP, TCP or HTTP) on port 12201. Fields arrive as `_category`,
`_request_id`, `_trace_id`, `_user_id`, and the message's own values as `_prop_<name>`.

**Already collecting container logs** with Promtail, Alloy, Filebeat, Fluent Bit or Vector? Set
`LOG_FORMAT=json` and point them at `docker logs`, or at `/data/logs/*.log`.

## Access and event log

**Admin > Logs** keeps two logs in the database, apart from your data and never in backups:

- **Events**: sign-ins (and failed ones, lockouts, provider sign-ins and links), password changes
  and resets, accounts added, turned off or on, role and group changes, provider unlinks and
  migration windows, viewing the app as someone (start and end), friendships set by an admin,
  sign-ups and invite links, sharing (a list shared or made private, people added to or taken off a
  list or a group, roles changed), settings saved (which ones, never their values), restarts,
  backups (scheduled ones too, and failed ones), exports, restores and debug dumps.
- **Requests**: every API and sign-in request, with the route (never the query string or body), the
  answer, how long it took, the person, address and device.

Each entry says who, the admin viewing the app as them if any, what, about whom, how it ended,
from where and when. Search, filter by area, outcome, person, address and dates, open an entry for
its details, and download the filtered set as CSV. Entries also go to the logs (categories
`PeckList.Audit` and `PeckList.Access`), so they reach a log server too;
`LOG_LEVEL_OVERRIDES=PeckList.Access=warning` keeps requests out of the console.

Old entries are removed hourly: events after `AUDIT_RETENTION_DAYS` (90), requests after
`ACCESS_LOG_RETENTION_DAYS` (14). `AUDIT_ARCHIVE=true` writes them to gzipped JSON lines in
`AUDIT_ARCHIVE_DIR` first. Behind a reverse proxy, check [`TRUSTED_PROXIES`](../install/reverse-proxy.md#trusted-proxies)
so the log shows people's own addresses, not the proxy's.

## Debug dump

For a bug report: **Admin > Logs > Download debug dump**, or

```bash
docker exec punchlist punchlist debug-dump /data/debug.zip
```

The zip holds recent logs, every setting with where it comes from (secrets shown as `********`),
the version, build, time zone, platform, database row counts and health. It never holds task
content, password hashes or keys, so it can go with a public issue.
