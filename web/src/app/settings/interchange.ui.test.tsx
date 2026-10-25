import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const HEADER =
  '"Folder Name","List Name","Title","Kind","Tags","Content","Is Check list","Start Date","Due Date","Reminder","Repeat","Priority","Status","Created Time","Completed Time","Order","Timezone","Is All Day","Is Floating","Column Name","Column Order","View Mode","taskId","parentId","projectKind"';
const BACKUP = [
  '"Date: 2026-10-25+0000"',
  HEADER,
  '"","Garden","Plant bulbs","TEXT","yard","","N","","","","","5","0","2026-10-01T12:00:00+0000","","0","UTC","false","false","","","list","1","","TASK"',
  '"","Garden","Pack","CHECKLIST","","▪Boots▫Gloves","Y","","","","","0","0","2026-10-01T12:00:00+0000","","1","UTC","false","false","","","list","2","","TASK"',
].join('\n');

async function openImport() {
  const data = await screen.findByRole('region', { name: 'Your data' });
  await userEvent.click(within(data).getByRole('button', { name: 'Import from another app' }));
  return screen.findByRole('dialog', { name: 'Import from another app' });
}

const titles = (store: ReturnType<typeof testStore>) =>
  store
    .getState()
    .workspace!.entities.tasks.filter((task) => !task.deletedAt)
    .map((task) => task.title)
    .sort();

describe('settings: import from another app', () => {
  it('previews a TickTick backup, merges it, and one undo takes it back', async () => {
    const store = testStore();
    await renderApp('/settings', store);
    const dialog = await openImport();
    expect(within(dialog).getByText(/Settings > Account > Backup/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Import' })).toBeDisabled();
    await userEvent.upload(
      within(dialog).getByLabelText('Choose file'),
      new File([BACKUP], 'TickTick-backup.csv', { type: 'text/csv' }),
    );
    const preview = await within(dialog).findByTestId('import-preview');
    expect(preview).toHaveTextContent('1 lists, 2 open and 0 closed tasks, 1 tags.');
    expect(within(dialog).getByRole('radio', { name: /Merge with what you have/ })).toBeChecked();
    const before = titles(store);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('region', { name: 'Your data' })).toHaveTextContent(
      'Imported from TickTick: 2 tasks, 1 new lists and 1 new tags.',
    );
    expect(titles(store)).toEqual([...before, 'Pack', 'Plant bulbs'].sort());
    expect(store.getState().lastUndoable?.label).toBe('Imported from TickTick');
    store.getState().undo();
    expect(titles(store)).toEqual(before);
  });

  it('replacing says what goes to the Trash, and does it', async () => {
    const store = testStore();
    await renderApp('/settings', store);
    store
      .getState()
      .apply(
        (ctx, ws) =>
          createTask(ctx, ws, { title: 'Old loose task', listId: inboxList(ws).id }).workspace,
      );
    const dialog = await openImport();
    await userEvent.upload(
      within(dialog).getByLabelText('Choose file'),
      new File([BACKUP], 'TickTick-backup.csv', { type: 'text/csv' }),
    );
    await within(dialog).findByTestId('import-preview');
    await userEvent.click(within(dialog).getByRole('radio', { name: /Replace what you have/ }));
    expect(within(dialog).getByText(/tasks and .* tags go to the Trash first/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/What was here is in the Trash/)).toBeInTheDocument();
    expect(titles(store)).toEqual(['Pack', 'Plant bulbs']);
  });

  it('knows a Todoist file when TickTick is picked, and reads it as Todoist', async () => {
    const store = testStore();
    await renderApp('/settings', store);
    const dialog = await openImport();
    await userEvent.upload(
      within(dialog).getByLabelText('Choose file'),
      new File(
        [
          [
            'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT',
            'task,Apples @fruit,,1,1',
            'task,Ripe ones,,4,2',
          ].join('\n'),
        ],
        'Groceries.csv',
        { type: 'text/csv' },
      ),
    );
    expect(await within(dialog).findByTestId('import-preview')).toHaveTextContent(
      '1 lists, 2 open and 0 closed tasks, 1 tags.',
    );
    expect(within(dialog).getByRole('combobox', { name: 'From' })).toHaveTextContent('Todoist');
  });

  it('says so when the file is not that app’s', async () => {
    const store = testStore();
    await renderApp('/settings', store);
    const dialog = await openImport();
    await userEvent.upload(
      within(dialog).getByLabelText('Choose file'),
      new File(['just,some\ncsv,here'], 'other.csv', { type: 'text/csv' }),
    );
    expect(await within(dialog).findByText('That file has no tasks in it.')).toBeInTheDocument();
  });
});

describe('settings: export for another app', () => {
  it('lists Things links for Things, and downloads a file for the others', async () => {
    const store = testStore();
    const created: Blob[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return 'blob:test';
      },
      revokeObjectURL: () => undefined,
    });
    await renderApp('/settings', store);
    store
      .getState()
      .apply(
        (ctx, ws) =>
          createTask(ctx, ws, { title: 'Water plants', listId: inboxList(ws).id }).workspace,
      );
    const data = await screen.findByRole('region', { name: 'Your data' });
    await userEvent.click(within(data).getByRole('button', { name: 'Export for another app' }));
    const dialog = await screen.findByRole('dialog', { name: 'Export for another app' });
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'For' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Things 3' }));
    const links = await within(dialog).findByTestId('things-links');
    const link = within(links).getByRole('link', { name: 'Add part 1 of 1 to Things' });
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain('"title":"Water plants"');

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'For' }));
    await userEvent.click(await screen.findByRole('option', { name: 'iCalendar (.ics)' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    expect(created).toHaveLength(1);
    expect(await created[0]!.text()).toContain('SUMMARY:Water plants');
  });
});
