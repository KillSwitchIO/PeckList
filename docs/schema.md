# Workspace file format

The canonical data format is one JSON document per user, defined by [`schema/workspace.schema.json`](https://gitlab.com/killswitch10/punchlist/-/blob/main/schema/workspace.schema.json) (JSON Schema draft 2020-12). In standalone mode it holds everything; with a server it holds exactly what that user may see.

## Top level

| Field           | Meaning                                                              |
| --------------- | -------------------------------------------------------------------- |
| `schemaVersion` | Integer. Bumped on every schema change (see `docs/migrations/`)      |
| `app`           | `{ name: "punchlist", version }` of the app that last wrote the file |
| `owner`         | User id (ULID) the file belongs to                                   |
| `node`          | Device id used in this copy's HLC timestamps                         |
| `entities`      | One array per entity type                                            |
| `sync`          | `{ server, cursor }`; both null in standalone mode                   |

## Every entity

| Field                    | Meaning                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `id`                     | ULID                                                           |
| `createdAt`, `createdBy` | UTC timestamp, user id                                         |
| `deletedAt`              | Tombstone timestamp or null (soft delete, 30-day trash)        |
| `origin`                 | Home server of the record; `local` in standalone mode          |
| `_hlc`                   | Field name to hybrid logical clock timestamp of its last write |

## Merge rules

- Scalar fields: the value with the later `_hlc` timestamp wins. HLC format `<ISO time>-<4-digit counter>-<node>` sorts as a plain string.
- Element sets (`tasks.tags`, `tasks.assignees`, `tasks.blockedBy`): each element is `{ in, hlc }` and merges on its own.
- Entities present on only one side are kept.
- Manual order uses fractional index keys (`order`), compared as plain strings.

The rules are pinned by [`schema/fixtures/merge`](https://gitlab.com/killswitch10/punchlist/-/tree/main/schema/fixtures/merge); every implementation must pass them.

## Dates

- UTC timestamps: `2026-10-20T16:15:02.113Z`
- Schedules and due dates: a local date (`2026-11-03`) or local date-time without offset (`2026-11-03T09:00`) plus a `timeZone`.
