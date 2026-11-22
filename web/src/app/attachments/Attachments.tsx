import CloseRounded from '@mui/icons-material/CloseRounded';
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import {
  Alert,
  Box,
  ButtonBase,
  CircularProgress,
  Dialog,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import {
  attachmentsOf,
  canChangeAttachment,
  isPicture,
  removeAttachment,
  renameAttachment,
} from '../../core/attachments.ts';
import type { Attachment, Task } from '../../core/types.ts';
import { formatBytes } from '../format.ts';
import { useLongPress } from '../hooks/useLongPress.ts';
import { t } from '../i18n/i18n.ts';
import { NameDialog } from '../lists/ListDialog.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { loadFile, useFileUrl } from './fileStore.ts';

/**
 * A file's tile: a picture's thumbnail, or an icon with the name and size. Its menu (right-click,
 * a long press, or the keyboard's menu key) renames or removes it, as far as the person may.
 */
function FileTile({
  attachment,
  onOpen,
  onRename,
  onRemove,
}: {
  attachment: Attachment;
  onOpen: () => void;
  onRename: (() => void) | null;
  onRemove: (() => void) | null;
}) {
  const picture = isPicture(attachment.mime);
  const url = useFileUrl(attachment.sha256, attachment.mime, picture, true);
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const longPress = useLongPress((position) => setMenu(position));
  // A touch's own contextmenu after the long press would open the menu a second time (as TaskRow).
  const pointerKind = useRef('mouse');
  const hasMenu = onRename !== null || onRemove !== null;
  // A picture still loading keeps a plain tile, so nothing jumps when it arrives.
  const loading = picture && url === null;
  const label = `${attachment.name}, ${formatBytes(attachment.size)}`;
  const choose = (action: () => void) => {
    setMenu(null);
    action();
  };
  return (
    <Box
      role="listitem"
      aria-label={label}
      sx={{ position: 'relative' }}
      {...(hasMenu
        ? {
            ...longPress,
            onPointerDown: (event: PointerEvent) => {
              pointerKind.current = event.pointerType;
              longPress.onPointerDown(event);
            },
            onContextMenu: (event: MouseEvent) => {
              event.preventDefault();
              if (pointerKind.current === 'touch' || pointerKind.current === 'pen') return;
              setMenu({ top: event.clientY, left: event.clientX });
            },
          }
        : {})}
    >
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
          p: picture && url !== 'missing' ? 0 : 1,
          bgcolor: 'action.hover',
        }}
      >
        {loading ? null : picture && url && url !== 'missing' ? (
          <Box
            component="img"
            src={url}
            alt=""
            decoding="async"
            draggable={false}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
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
      <Menu
        open={menu !== null}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ?? undefined}
        // Its events bubble through React to the tile: a right-click on the menu must not move it.
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {onRename && <MenuItem onClick={() => choose(onRename)}>{t('common.rename')}</MenuItem>}
        {onRemove && <MenuItem onClick={() => choose(onRemove)}>{t('files.remove')}</MenuItem>}
      </Menu>
    </Box>
  );
}

/**
 * A picture, large, over everything. One neither this device nor the server can give closes again
 * and says so, as other files do (QA: it opened as an empty dark dialog).
 */
function PictureView({
  attachment,
  onClose,
  onMissing,
}: {
  attachment: Attachment;
  onClose: () => void;
  onMissing: () => void;
}) {
  const url = useFileUrl(attachment.sha256, attachment.mime, true);
  useEffect(() => {
    if (url === 'missing') onMissing();
  }, [url, onMissing]);
  if (url === 'missing') return null;
  return (
    <Dialog open onClose={onClose} maxWidth="lg" aria-label={attachment.name}>
      {url ? (
        <Box
          component="img"
          src={url}
          alt={attachment.name}
          decoding="async"
          sx={{ display: 'block', maxWidth: '100%', maxHeight: '85dvh' }}
        />
      ) : (
        // Still coming from the server: a spinner, not an empty dark box.
        <Box sx={{ display: 'flex', p: 4 }}>
          <CircularProgress aria-label={t('status.waiting')} />
        </Box>
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
  const [renaming, setRenaming] = useState<Attachment | null>(null);
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
        {list.map((attachment) => {
          // Who added a file renames it; they, or the list's owner, remove it (as the server).
          const may = canChangeAttachment(workspace, me, attachment);
          return (
            <FileTile
              key={attachment.id}
              attachment={attachment}
              onOpen={() => void open(attachment)}
              onRename={may.rename ? () => setRenaming(attachment) : null}
              onRemove={
                may.remove
                  ? () =>
                      apply(
                        (ctx, ws) => removeAttachment(ctx, ws, attachment.id),
                        t('undo.fileRemoved'),
                      )
                  : null
              }
            />
          );
        })}
      </Box>
      {viewing && (
        <PictureView
          attachment={viewing}
          onClose={() => setViewing(null)}
          onMissing={() => {
            setViewing(null);
            setMissing(viewing.name);
          }}
        />
      )}
      {renaming && (
        <NameDialog
          open
          fileName
          title={t('files.renameTitle')}
          label={t('files.name')}
          initial={renaming.name}
          submitLabel={t('common.save')}
          onClose={() => setRenaming(null)}
          onSubmit={(name) => {
            const id = renaming.id;
            setRenaming(null);
            if (name !== renaming.name) {
              apply((ctx, ws) => renameAttachment(ctx, ws, id, name), t('undo.fileRenamed'));
            }
          }}
        />
      )}
    </Box>
  );
}
