import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { createMemoryStorage } from '../adapters/memory-storage.ts';
import { createUlidGenerator } from '../adapters/ulid-ids.ts';
import { CURRENT_SCHEMA_VERSION } from '../core/migrations.ts';
import type { StorageAdapter } from '../ports/storage.ts';
import { AppProviders } from './providers.tsx';
import { createWorkspaceStore } from './store/workspaceStore.ts';

async function renderWith(stored: unknown) {
  const storage = createMemoryStorage();
  if (stored !== undefined) await storage.save(stored as never);
  const store = createWorkspaceStore({
    storage,
    validator: createAjvValidator(),
    ids: createUlidGenerator(),
    node: 'test',
  });
  render(
    <AppProviders store={store}>
      <p>app content</p>
    </AppProviders>,
  );
}

describe('StatusGate', () => {
  it('shows the app once a new workspace is created', async () => {
    await renderWith(undefined);
    expect(await screen.findByText('app content')).toBeInTheDocument();
  });

  it('refuses data from a newer version and offers an update', async () => {
    const newer = CURRENT_SCHEMA_VERSION + 1;
    await renderWith({ schemaVersion: newer });
    expect(
      await screen.findByText('This data needs a newer version of Punchlist'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(`schema ${newer}; this app supports up to ${CURRENT_SCHEMA_VERSION}`),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    expect(screen.queryByText('app content')).not.toBeInTheDocument();
  });

  it('offers to upgrade older data, with the button under the explanation', async () => {
    const fresh = createWorkspaceStore({
      storage: createMemoryStorage(),
      validator: createAjvValidator(),
      ids: createUlidGenerator(),
      node: 'test',
    });
    await fresh.getState().init();
    const legacy = structuredClone(fresh.getState().workspace!) as unknown as {
      schemaVersion: number;
      entities: { tasks: Record<string, unknown>[] };
    };
    legacy.schemaVersion = 1;
    for (const task of legacy.entities.tasks) delete task.progress;
    await renderWith(legacy);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your data needs an upgrade' }),
    ).toBeInTheDocument();
    const status = screen.getByRole('status');
    const button = screen.getByRole('button', { name: 'Back up and upgrade' });
    expect(status).toContainElement(button);
    // Stacked: the explanation comes before the button.
    expect(status.lastElementChild).toBe(button);
    await userEvent.click(button);
    expect(await screen.findByText('app content')).toBeInTheDocument();
  });

  it('explains invalid data', async () => {
    await renderWith({ schemaVersion: CURRENT_SCHEMA_VERSION });
    expect(await screen.findByText('Punchlist could not open your data')).toBeInTheDocument();
  });

  it('explains storage failures', async () => {
    const storage: StorageAdapter = {
      kind: 'x',
      load: () => Promise.reject(new Error('disk full')),
      save: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      backup: () => Promise.resolve(),
      loadBackup: () => Promise.resolve(null),
      loadMeta: () => Promise.resolve(null),
      saveMeta: () => Promise.resolve(),
    };
    const store = createWorkspaceStore({
      storage,
      validator: createAjvValidator(),
      ids: createUlidGenerator(),
      node: 'test',
    });
    render(
      <AppProviders store={store}>
        <p>app content</p>
      </AppProviders>,
    );
    expect(await screen.findByText('disk full')).toBeInTheDocument();
  });
});
