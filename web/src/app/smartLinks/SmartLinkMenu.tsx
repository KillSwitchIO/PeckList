import {
  ClickAwayListener,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  MenuList,
  Paper,
  Popper,
  useTheme,
} from '@mui/material';
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import {
  appleMapsHref,
  googleMapsHref,
  mailHref,
  openStreetMapHref,
  smsHref,
  telHref,
  webHref,
  type SmartKind,
} from '../../core/smartLinks.ts';
import { copyText } from '../copy.ts';
import {
  CheckIcon,
  CopyIcon,
  MailIcon,
  MapPinIcon,
  MessageIcon,
  OpenOutsideIcon,
  PhoneIcon,
} from '../icons/icons.tsx';
import { t } from '../i18n/i18n.ts';
import { openOutside } from './openOutside.ts';

/**
 * A smart link to offer choices for: its kind and its text (the address, number or email). A link
 * already in the notes also has its own `href`, which is what opens, as written.
 */
export interface SmartTarget {
  kind: SmartKind;
  text: string;
  href?: string;
}

interface Choice {
  key: string;
  label: string;
  icon: ReactNode;
  href: string;
}

function choices({ kind, text, href }: SmartTarget): Choice[] {
  switch (kind) {
    case 'web':
      return [
        {
          key: 'open',
          label: t('smartLinks.open'),
          icon: <OpenOutsideIcon fontSize="small" />,
          href: href ?? webHref(text),
        },
      ];
    case 'email':
      return [
        {
          key: 'email',
          label: t('smartLinks.email'),
          icon: <MailIcon fontSize="small" />,
          href: href ?? mailHref(text),
        },
      ];
    case 'phone':
      return [
        {
          key: 'call',
          label: t('smartLinks.call'),
          icon: <PhoneIcon fontSize="small" />,
          href: telHref(text),
        },
        {
          key: 'text',
          label: t('smartLinks.text'),
          icon: <MessageIcon fontSize="small" />,
          href: smsHref(text),
        },
      ];
    case 'address':
      return [
        {
          key: 'google',
          label: t('smartLinks.googleMaps'),
          icon: <MapPinIcon fontSize="small" />,
          href: googleMapsHref(text),
        },
        {
          key: 'apple',
          label: t('smartLinks.appleMaps'),
          icon: <MapPinIcon fontSize="small" />,
          href: appleMapsHref(text),
        },
        {
          key: 'osm',
          label: t('smartLinks.openStreetMap'),
          icon: <MapPinIcon fontSize="small" />,
          href: openStreetMapHref(text),
        },
      ];
  }
}

/**
 * The choices for a smart link in a browser (PL-146): call, text or copy a number; open an address
 * in Google Maps, Apple Maps or OpenStreetMap, or copy it; write to or copy an email address; open
 * or copy a web address. A small menu at the click, as the app's other popovers.
 */
export function SmartLinkMenu({
  target,
  anchor,
  onClose,
  onCopyFailed,
  inText = false,
}: {
  target: SmartTarget | null;
  anchor: { top: number; left: number } | null;
  onClose: () => void;
  /** Nothing could be copied (no clipboard here): select the text for a copy by hand. */
  onCopyFailed?: () => void;
  /**
   * Over text being edited (the notes): a popover that leaves the focus and the selection in the
   * text, with no backdrop, closed by a click elsewhere or Escape, so typing and selecting go on.
   */
  inText?: boolean;
}) {
  const theme = useTheme();
  // The last item shown stays in the menu while it fades out.
  const [shown, setShown] = useState(target);
  if (target !== null && target !== shown) setShown(target);
  const [copiedFor, setCopiedFor] = useState<SmartTarget | null>(null);
  const copied = copiedFor !== null && copiedFor === (target ?? shown);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(onClose, 700);
    return () => window.clearTimeout(timer);
  }, [copied, onClose]);
  const open = target !== null && anchor !== null;
  const item = target ?? shown;
  useEffect(() => {
    if (!open || !inText) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Only the popover closes; the notes stay open.
      event.stopPropagation();
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [open, inText, onClose]);
  const items = [
    item && (
      <ListSubheader
        disableSticky
        sx={{
          lineHeight: 2.25,
          maxWidth: 280,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          typography: 'caption',
          color: 'text.secondary',
        }}
      >
        {item.text}
      </ListSubheader>
    ),
    ...(item
      ? choices(item).map((choice) => (
          <MenuItem
            key={choice.key}
            onMouseDown={keepFocus}
            onClick={() => {
              onClose();
              openOutside(choice.href);
            }}
          >
            <ListItemIcon>{choice.icon}</ListItemIcon>
            <ListItemText>{choice.label}</ListItemText>
          </MenuItem>
        ))
      : []),
    item && (
      <MenuItem
        key="copy"
        onMouseDown={keepFocus}
        onClick={(event) => {
          if (copied || !target) return;
          const near = event.currentTarget;
          void copyText(target.text, near).then((ok) => {
            if (ok) {
              setCopiedFor(target);
              return;
            }
            onClose();
            onCopyFailed?.();
          });
        }}
      >
        <ListItemIcon>
          {copied ? <CheckIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
        </ListItemIcon>
        <ListItemText>{copied ? t('smartLinks.copied') : t('smartLinks.copy')}</ListItemText>
      </MenuItem>
    ),
  ];
  if (!inText) {
    return (
      <Menu
        open={open}
        onClose={onClose}
        anchorReference="anchorPosition"
        anchorPosition={anchor ?? undefined}
        slotProps={{ list: { dense: true, 'aria-label': item?.text } }}
      >
        {items}
      </Menu>
    );
  }
  const at = anchor;
  return (
    <Popper
      open={open}
      placement="bottom-start"
      anchorEl={
        at ? { getBoundingClientRect: () => new DOMRect(at.left, at.top, 0, 0) } : undefined
      }
      sx={{ zIndex: theme.zIndex.modal + 1 }}
    >
      <ClickAwayListener onClickAway={onClose}>
        <Paper elevation={6} sx={{ borderRadius: 2 }}>
          <MenuList dense aria-label={item?.text}>
            {items}
          </MenuList>
        </Paper>
      </ClickAwayListener>
    </Popper>
  );
}

/** In the popover over the notes, a press keeps the focus (and the selection) in the text. */
function keepFocus(event: MouseEvent) {
  event.preventDefault();
}
