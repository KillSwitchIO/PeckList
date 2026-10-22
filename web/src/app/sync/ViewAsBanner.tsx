import { Box, Button, Paper, Typography } from '@mui/material';
import { t } from '../i18n/i18n.ts';
import { forgetViewAs, type ViewAs } from '../store/viewAs.ts';

/** End the view: tell the server, forget the token, and leave this tab. */
async function endView(view: ViewAs) {
  try {
    await fetch('/auth/impersonation', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'X-Punchlist-Impersonate': view.token },
    });
  } finally {
    forgetViewAs();
    window.close();
    // A tab the browser will not close goes back to the admin's own app.
    window.location.replace('/admin');
  }
}

/** Always on screen while viewing as someone: who, and the way out. Floats, so nothing moves. */
export function ViewAsBanner({ view }: { view: ViewAs }) {
  return (
    <Paper
      role="status"
      elevation={6}
      sx={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: { xs: 76, sm: 16 },
        zIndex: (theme) => theme.zIndex.snackbar,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        pl: 2,
        pr: 1,
        py: 0.5,
        borderRadius: 999,
        bgcolor: 'warning.main',
        color: 'warning.contrastText',
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <Typography variant="body2" noWrap>
        {t('viewAs.banner', { name: view.username })}
      </Typography>
      <Button
        size="small"
        color="inherit"
        onClick={() => void endView(view)}
        sx={{ fontWeight: 600 }}
      >
        {t('viewAs.end')}
      </Button>
    </Paper>
  );
}

/** Shown once the view has run out or was ended elsewhere. */
export function ViewEnded() {
  return (
    <Box
      sx={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '100dvh',
        px: 2,
        textAlign: 'center',
      }}
    >
      <Box>
        <Typography variant="h1" sx={{ fontSize: '1.375rem', mb: 1 }}>
          {t('viewAs.endedTitle')}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {t('viewAs.endedText')}
        </Typography>
        <Button
          variant="contained"
          disableElevation
          onClick={() => {
            forgetViewAs();
            window.location.replace('/admin');
          }}
        >
          {t('viewAs.back')}
        </Button>
      </Box>
    </Box>
  );
}
