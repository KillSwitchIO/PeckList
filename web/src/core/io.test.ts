import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { sampleWorkspace } from '../test/fixtures.ts';
import { openDocument, parseJson, upgradeDocument } from './io.ts';
import { serializeWorkspace } from './workspace.ts';

const validator = createAjvValidator();

describe('parseJson', () => {
  it('parses valid JSON and reports errors', () => {
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    const bad = parseJson('{oops');
    expect(bad.ok).toBe(false);
  });
});

describe('openDocument', () => {
  it('opens a valid current-version workspace', () => {
    const workspace = sampleWorkspace();
    const reopened = JSON.parse(serializeWorkspace(workspace)) as unknown;
    expect(openDocument(reopened, validator)).toEqual({ kind: 'ok', workspace });
  });

  it('reports schema errors', () => {
    const workspace = sampleWorkspace();
    (workspace.entities.tasks[0] as unknown as Record<string, unknown>).priority = 7;
    const result = openDocument(workspace, validator);
    expect(result.kind).toBe('invalid');
  });

  it('refuses newer files and asks to upgrade older ones', () => {
    expect(openDocument({ schemaVersion: 2 }, validator)).toEqual({
      kind: 'needs-app-update',
      fileVersion: 2,
      supported: 1,
    });
    expect(openDocument({ schemaVersion: 1 }, validator, 2).kind).toBe('needs-upgrade');
    expect(openDocument({}, validator).kind).toBe('invalid');
  });
});

describe('upgradeDocument', () => {
  it('migrates then validates', () => {
    const workspace = sampleWorkspace();
    const old = { ...structuredClone(workspace), schemaVersion: 0 } as unknown as Record<
      string,
      unknown
    >;
    // schemaVersion 0 is malformed, so migration fails cleanly
    expect(upgradeDocument(old, validator).kind).toBe('invalid');
  });

  it('runs a registered migration to the current version', () => {
    const workspace = sampleWorkspace();
    const legacy = { ...structuredClone(workspace), schemaVersion: 1 } as unknown as Record<
      string,
      unknown
    >;
    const result = upgradeDocument(legacy, validator, 1, {});
    expect(result).toEqual({ kind: 'ok', workspace });
  });
});
