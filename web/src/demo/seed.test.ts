// The demo seed (PL-117): what `punchlist import` loads on the demo server every night.
import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { openDocument } from '../core/io.ts';
import { CURRENT_SCHEMA_VERSION } from '../core/migrations.ts';
import { DEMO_USERNAMES, buildDemoSeed } from './seed.ts';

const TODAY = '2026-10-30';
const seed = buildDemoSeed(TODAY);

describe('the demo seed', () => {
  it('is a server backup of this schema with the three demo accounts, plain users without passwords', () => {
    expect(seed.file.format).toBe('punchlist-server-backup');
    expect(seed.file.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(seed.file.accounts.map((account) => account.username)).toEqual([...DEMO_USERNAMES]);
    for (const account of seed.file.accounts) {
      expect(account.role).toBe('user');
      expect(account.passwordHash).toBeNull();
    }
  });

  it('holds only entities the app accepts', () => {
    expect(openDocument(seed.workspace, createAjvValidator()).kind).toBe('ok');
  });

  it('gives every entity to one of the demo accounts', () => {
    const ids = new Set(seed.file.accounts.map((account) => account.id));
    const strays = seed.file.entities.filter((entity) => !ids.has(entity.ownerId));
    expect(strays).toEqual([]);
  });

  it('shares lists with each demo account, so sharing shows without an invite', () => {
    for (const account of seed.file.accounts) {
      const sharedWith = seed.workspace.entities.listMembers.filter(
        (member) => member.principal === `user:${account.id}` && member.createdBy !== account.id,
      );
      expect(sharedWith.length).toBeGreaterThan(0);
    }
  });

  it('has something for today and nothing made after the seed day began', () => {
    const live = seed.workspace.entities.tasks.filter((task) => !task.deletedAt);
    expect(live.some((task) => task.schedule?.start.startsWith(TODAY))).toBe(true);
    const latest = Math.max(
      ...seed.workspace.entities.tasks.map((task) => Date.parse(task.createdAt)),
    );
    expect(latest).toBeLessThanOrEqual(Date.parse(seed.file.exportedAt));
  });

  it('comes out the same for the same day', () => {
    expect(JSON.stringify(buildDemoSeed(TODAY).file)).toBe(JSON.stringify(seed.file));
  });
});
