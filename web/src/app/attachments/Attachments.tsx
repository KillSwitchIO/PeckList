import CloseRounded from '@mui/icons-material/CloseRounded';
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import { Alert, Box, ButtonBase, Dialog, IconButton, Tooltip, Typography } from '@mui/material';
import { useRef, useState, type ReactNode } from 'react';
import {
  addAttachment,
  attachmentsOf,
  canAttach,
  canChangeAttachment,
  isPicture,
  removeAttachment,
} from '../../core/attachments.ts';
import type { Attachment, Task } from '../../core/types.ts';
import { formatBytes } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { hashFile, loadFile, useFileUrl } from './fileStore.ts';

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

/** A file's tile: a picture's thumbnail, or an icon with the name and size. */
function FileTile({
  attachment,
  onOpen,
  onRemove,
}: {
  attachment: Attachment;
  onOpen: () => void;
  onRemove: (() => void) | null;
}) {
  const picture = isPicture(attachment.mime);
  const url = useFileUrl(attachment.sha256, attachment.mime, picture);
  const label = `${attachment.name}, ${formatBytes(attachment.size)}`;
  return (
    <Box role="listitem" aria-label={label} sx={{ position: 'relative' }}>
      <ButtonBase
        onClick={onOpen}
        aria-label={t('files.open', { name: attachment.name })}
        sx={{
          width: 96,
          height: 96,
          borderRadius: 1.5,
          border: 1,
          borderColor: 'divider',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.5,
          p: picture && url && url !== 'missing' ? 0 : 1,
          bgcolor: 'action.hover',
        }}
      >
        {picture && url && url !== 'missing' ? (
          <Box
            component="img"
            src={url}
            alt=""
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <>
            <InsertDriveFileOutlined sx={{ color: 'text.secondary' }} />
            <Typography
              variant="caption"
              sx={{
                width: '100%',
                textAlign: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {attachment.name}
            </Typography>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
              {url === 'missing' ? t('files.notHere') : formatBytes(attachment.size)}
            </Typography>
          </>
        )}
      </ButtonBase>
      {onRemove && (
        <Tooltip title={t('files.remove')}>
          <IconButton
            size="small"
            aria-label={t('files.removeNamed', { name: attachment.name })}
            onClick={onRemove}
            sx={{
              position: 'absolute',
              top: -8,
              right: -8,
              width: 22,
              height: 22,
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              '&:hover': { bgcolor: 'background.paper' },
            }}
          >
            <CloseRounded sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

/** A picture, large, over everything. */
function PictureView({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const url = useFileUrl(attachment.sha256, attachment.mime, true);
  return (
    <Dialog open onClose={onClose} maxWidth="lg" aria-label={attachment.name}>
      {url && url !== 'missing' && (
        <Box
          component="img"
          src={url}
          alt={attachment.name}
          sx={{ display: 'block', maxWidth: '100%', maxHeight: '85dvh' }}
        />
      )}
    </Dialog>
  );
}

/** The task's files (spec: PL-051): pictures open large, other files download. */
export function AttachmentList({
  task,
  problem,
  onDismissProblem,
}: {
  task: Task;
  problem: string | null;
  onDismissProblem: () => void;
}) {
  const workspace = useWorkspace();
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const blobs = useSyncState((state) => state.blobs);
  const files = useSyncState((state) => state.transport.files);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const list = attachmentsOf(workspace, task.id);
  if (list.length === 0 && !problem) return null;

  const open = async (attachment: Attachment) => {
    if (isPicture(attachment.mime)) {
      setViewing(attachment);
      return;
    }
    const blob = await loadFile(attachment.sha256, blobs, files);
    if (!blob) {
      setMissing(attachment.name);
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <Box component="section" aria-label={t('files.title')}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        {t('files.title')}
      </Typography>
      {problem && (
        <Alert severity="warning" variant="outlined" onClose={onDismissProblem} sx={{ mb: 1 }}>
          {problem}
        </Alert>
      )}
      {missing && (
        <Alert severity="info" variant="outlined" onClose={() => setMissing(null)} sx={{ mb: 1 }}>
          {t('files.missing', { name: missing })}
        </Alert>
      )}
      <Box role="list" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, pt: 1 }}>
        {list.map((attachment) => (
          <FileTile
            key={attachment.id}
            attachment={attachment}
            onOpen={() => void open(attachment)}
            onRemove={
              canChangeAttachment(workspace, me, attachment).remove
                ? () =>
                    apply(
                      (ctx, ws) => removeAttachment(ctx, ws, attachment.id),
                      t('undo.fileRemoved'),
                    )
                : null
            }
          />
        ))}
      </Box>
      {viewing && <PictureView attachment={viewing} onClose={() => setViewing(null)} />}
    </Box>
  );
}
