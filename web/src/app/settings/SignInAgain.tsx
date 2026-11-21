import { Alert, Box, Button, DialogContentText } from '@mui/material';
import type { MessageKey } from '../i18n/i18n.ts';
import { t } from '../i18n/i18n.ts';
import { leaveFor } from '../sync/signInWith.ts';
import type { WayBack } from './deleteAccount.ts';

/** What one dialog says while asking for a fresh sign-in. */
export interface SignInAgainText {
  signInAgain: MessageKey;
  stillNotRecent: MessageKey;
  useBrowser: MessageKey;
  noWayBack: MessageKey;
}

/**
 * For an account without a password (Delete my account, Start over): a real sign-in first, which
 * comes back to the dialog.
 */
export function SignInAgain({
  ways,
  appCanSignIn,
  returned,
  text,
}: {
  ways: WayBack[] | null;
  appCanSignIn: boolean;
  returned: boolean;
  text: SignInAgainText;
}) {
  if (!appCanSignIn) {
    return (
      <Alert severity="info" variant="outlined">
        {t(text.useBrowser)}
      </Alert>
    );
  }
  if (ways === null) return null;
  if (ways.length === 0) {
    return (
      <Alert severity="info" variant="outlined">
        {t(text.noWayBack)}
      </Alert>
    );
  }
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {/* Back from it and still not recent: the provider let them in without asking again. */}
      {returned && (
        <Alert severity="warning" variant="outlined">
          {t(text.stillNotRecent)}
        </Alert>
      )}
      <DialogContentText>{t(text.signInAgain)}</DialogContentText>
      {ways.map((way) => (
        <Button key={way.url} variant="outlined" onClick={() => leaveFor(way.url)}>
          {way.label}
        </Button>
      ))}
    </Box>
  );
}
