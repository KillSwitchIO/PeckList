import { IconButton, Tooltip } from '@mui/material';
import { t } from '../i18n/i18n.ts';
import { PinIcon } from '../icons/icons.tsx';

/** A pin toggle on list and tag rows while the sidebar is being edited. */
export function PinButton({
  pinned,
  name,
  onToggle,
}: {
  pinned: boolean;
  name: string;
  onToggle: () => void;
}) {
  return (
    <Tooltip title={pinned ? t('nav.unpin') : t('nav.pin')}>
      <IconButton
        size="small"
        edge="end"
        aria-pressed={pinned}
        aria-label={t(pinned ? 'nav.unpinNamed' : 'nav.pinNamed', { name })}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        sx={{ color: pinned ? 'primary.main' : 'text.disabled' }}
      >
        <PinIcon fontSize="small" filled={pinned} />
      </IconButton>
    </Tooltip>
  );
}
