import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { t } from '../i18n/i18n.ts';
import { SHORTCUTS, type Shortcut } from './shortcuts.ts';

const GROUPS: {
  group: Shortcut['group'];
  title: 'shortcut.general' | 'shortcut.go' | 'shortcut.task';
}[] = [
  { group: 'general', title: 'shortcut.general' },
  { group: 'go', title: 'shortcut.go' },
  { group: 'task', title: 'shortcut.task' },
];

/** The "?" list of keyboard shortcuts, from the same registry the keys use. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('shortcut.title')}</DialogTitle>
      <DialogContent>
        {GROUPS.map(({ group, title }) => (
          <Box key={group} component="section" aria-label={t(title)} sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
              {t(title)}
            </Typography>
            {SHORTCUTS.filter((each) => each.group === group).map((each) => (
              <Box
                key={each.label}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  py: 0.5,
                }}
              >
                <Typography variant="body2">{t(each.description)}</Typography>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {each.label.split(' ').map((key, index) => (
                    <Box
                      key={index}
                      component="kbd"
                      sx={{
                        minWidth: 24,
                        px: 0.75,
                        py: 0.25,
                        borderRadius: 1,
                        border: 1,
                        borderColor: 'divider',
                        bgcolor: 'action.hover',
                        typography: 'caption',
                        fontFamily: 'inherit',
                        textAlign: 'center',
                      }}
                    >
                      {key}
                    </Box>
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.done')}</Button>
      </DialogActions>
    </Dialog>
  );
}
