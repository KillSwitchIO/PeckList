import { useRef, useState, type ReactNode } from 'react';
import { addAttachment, canAttach } from '../../core/attachments.ts';
import type { Task } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { hashFile } from './fileStore.ts';

/** The largest file when the server names none (or there is no server). */
const DEFAULT_MAX_MB = 25;

/**
 * Adding files to a task (spec: PL-051): from a file picker or dropped on the details. Each is
 * hashed, kept on this device, and recorded on the task; the sync sends the bytes first.
 */
export function useAttachFiles(task: Task | undefined): {
  allowed: boolean;
  pick: () => void;
  add: (files: Iterable<File>) => Promise<void>;
  input: ReactNode;
  problem: string | null;
  clearProblem: () => void;
} {
  const workspace = useWorkspace();
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const blobs = useSyncState((state) => state.blobs);
  const maxMb = useSyncState((state) => state.server?.attachmentMaxMb ?? DEFAULT_MAX_MB);
  const picker = useRef<HTMLInputElement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const allowed = task !== undefined && canAttach(workspace, me, task);

  const add = async (files: Iterable<File>) => {
    if (!allowed || !task) return;
    const tooLarge: string[] = [];
    for (const file of files) {
      if (file.size > maxMb * 1024 * 1024) {
        tooLarge.push(file.name);
        continue;
      }
      const sha256 = await hashFile(file);
      await blobs.put(sha256, file);
      apply(
        (ctx, ws) =>
          addAttachment(ctx, ws, {
            taskId: task.id,
            name: file.name,
            size: file.size,
            mime: file.type,
            sha256,
          }).workspace,
      );
    }
    setProblem(
      tooLarge.length === 0
        ? null
        : t('files.tooLarge', { names: tooLarge.join(', '), max: maxMb }),
    );
  };

  const input = (
    <input
      ref={picker}
      type="file"
      multiple
      hidden
      aria-hidden
      tabIndex={-1}
      data-testid="attach-input"
      onChange={(event) => {
        const chosen = Array.from(event.target.files ?? []);
        event.target.value = '';
        void add(chosen);
      }}
    />
  );
  return {
    allowed,
    pick: () => picker.current?.click(),
    add,
    input,
    problem,
    clearProblem: () => setProblem(null),
  };
}
