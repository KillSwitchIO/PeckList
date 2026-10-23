# Monitoring and stats

## Health

| Check                   | Answers                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `GET /healthz`          | `200 Healthy` when the server and its database work; `503` otherwise. No sign-in needed. |
| `GET /api/info`         | `{"name":"punchlist","version":"0.2.0","schemaVersion":5}`. No sign-in needed.           |
| `punchlist healthcheck` | Exit code 0 when the running server answers `/healthz` (the image's own health check).   |

Point Uptime Kuma, Gatus, Healthchecks or your monitoring at `/healthz`. In Docker, `docker ps`
shows the container's health; Compose's `depends_on: condition: service_healthy` can wait for it.

## Server stats

**Admin > Stats** shows:

- Server totals: people, open and closed tasks, closed this month, lists, shared lists, storage.
- Closed tasks per month for the last 12 months.
- A row per person, sortable by any column: open, closed all time and this month, tasks made,
  lists, shared lists, storage, devices that synced in the last 30 days, and when they were last
  active. Click a person for their months.

Only counts, never titles or other content. Months follow the server's time zone (`TZ`). The
numbers are worked out again after a sync changes data, or every five minutes. Everyone sees their
own numbers under **Settings > Your stats**.

## Logs and alerts

Ship [logs](logging.md) to Loki, Elasticsearch, Graylog or an OpenTelemetry collector and alert on
`level="error"`, or on the event log's failed sign-ins (`Punchlist.Audit` category).
