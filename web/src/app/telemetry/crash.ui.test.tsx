import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import type { CrashReportDraft } from '../../ports/sync.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { testStore } from '../../test/renderApp.tsx';
import { SyncContext } from '../sync/syncContext.ts';
import { createSyncEngine } from '../sync/syncEngine.ts';
import { crashReport, scrub } from './crash.ts';
import { CrashBoundary, NativeCrashOffer } from './CrashBoundary.tsx';
import { setNativeShell } from '../native/shell.ts';
import type { NativeShell } from '../../ports/nativeShell.ts';
import { nativeCrashReport } from './crash.ts';

function Bomb(): never {
  throw new TypeError('cannot read the title of "Groceries"');
}

function app(backend: FakeBackend, Child: () => never = Bomb) {
  const transport = backend.device();
  transport.session = 'sam';
  const engine = createSyncEngine({
    transport,
    workspace: testStore(),
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return render(
    <SyncContext.Provider value={engine}>
      <CrashBoundary>
        <Child />
      </CrashBoundary>
    </SyncContext.Provider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('crash reports (PL-116)', () => {
  it('takes addresses, queries, emails and long ids out of a stack', () => {
    expect(
      scrub(
        'at x (https://tasks.example.com/assets/index-abc.js?v=2:10:5) sam@example.com 0123456789abcdef0123456789',
      ),
    ).toBe('at x (/assets/index-abc.js:10:5) [email] [id]');
    const report = crashReport(new TypeError('boom'));
    expect(report.kind).toBe('TypeError');
    expect(report.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(report.device.every((kind) => /^[a-z]+:[a-z]+$/.test(kind))).toBe(true);
  });

  it('shows the report in full and sends it only when the person says so', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    backend.crashReportsOn = true;
    app(backend);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'See what it holds' }));
    expect(screen.getByLabelText('The crash report')).toHaveTextContent('TypeError');
    expect(backend.crashes).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Sent. Thank you.')).toBeInTheDocument();
    expect(backend.crashes.map((each: CrashReportDraft) => each.kind)).toEqual(['TypeError']);
  });

  it('Never send asks no more and turns usage sharing off; Always send sends without asking', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    backend.crashReportsOn = true;
    const first = app(backend);
    await userEvent.click(await screen.findByRole('button', { name: 'Never send' }));
    await waitFor(() => expect(backend.crashChoice.get('sam')).toBe('never'));
    expect(backend.shareUsage.get('sam')).toBe(false);
    expect(backend.crashes).toEqual([]);
    first.unmount();

    backend.crashChoice.set('sam', 'always');
    app(backend);
    await waitFor(() => expect(backend.crashes).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('offers nothing on a server that takes no crash reports', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    app(backend);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });
});

describe('a part of the app that could not be fetched', () => {
  it('offers a reload and no crash report', async () => {
    function Gone(): never {
      throw new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js');
    }
    app(new FakeBackend(), Gone);
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByText('This page could not load')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.queryByRole('button', { name: 'See what it holds' })).toBeNull();
  });
});

describe('a crash in the Android app (PL-116)', () => {
  it('offers the report on the next start, from what the shell kept', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    backend.crashReportsOn = true;
    const lastCrash = vi.fn(() =>
      Promise.resolve({
        kind: 'ANR',
        stack:
          'Input dispatching timed out\n    at com.pecklist.app.Reminders.fire(Reminders.java:189)',
      }),
    );
    setNativeShell({
      lastCrash,
      info: () => Promise.resolve({ version: '0.8.0' }),
    } as unknown as NativeShell);
    const transport = backend.device();
    transport.session = 'sam';
    const engine = createSyncEngine({
      transport,
      workspace: testStore(),
      storage: createMemoryStorage(),
      debounceMs: 60_000,
      intervalMs: 600_000,
    });
    await engine.getState().start();
    render(
      <SyncContext.Provider value={engine}>
        <NativeCrashOffer />
      </SyncContext.Provider>,
    );
    expect(await screen.findByText('PeckList closed unexpectedly')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
    await waitFor(() => expect(backend.crashes).toHaveLength(1));
    expect(backend.crashes[0]).toMatchObject({ source: 'android', version: '0.8.0', kind: 'ANR' });
    setNativeShell(null);
    engine.getState().stop();
  });

  it('names an Android crash by its kind and first frame', () => {
    const a = nativeCrashReport(
      { kind: 'NullPointerException', stack: 'x\n    at a.b(C.java:1)' },
      '0.8.0',
    );
    const b = nativeCrashReport(
      { kind: 'NullPointerException', stack: 'other words\n    at a.b(C.java:1)' },
      '0.8.0',
    );
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.source).toBe('android');
  });
});
