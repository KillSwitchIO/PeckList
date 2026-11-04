// Send test email (PL-122), under the Email settings: an address, a button, and what the mail
// server answered. Email settings typed above but not saved yet are saved first (they apply at
// once), so the test uses what the page shows.

import { Alert, Box, Button, TextField } from '@mui/material';
import { useState } from 'react';
import type { AdminApi } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';

export function MailTestPanel({
  api,
  saveFirst,
}: {
  api: AdminApi;
  /** Saves email settings typed but not saved: null when saved, else why not. */
  saveFirst?: (() => Promise<string | null>) | undefined;
}) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true } | { ok: false; message: string } | null>(null);
  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const refused = saveFirst ? await saveFirst() : null;
      setResult(
        refused === null ? await api.sendTestMail(to.trim()) : { ok: false, message: refused },
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box sx={{ display: 'grid', gap: 1, px: 1, py: 1 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          type="email"
          label={t('mail.testTo')}
          value={to}
          onChange={(event) => setTo(event.target.value)}
          sx={{ flex: '1 1 240px' }}
        />
        <Button variant="outlined" disabled={busy || !to.includes('@')} onClick={() => void send()}>
          {saveFirst ? t('mail.saveAndSendTest') : t('mail.sendTest')}
        </Button>
      </Box>
      {result?.ok === true && (
        <Alert severity="success">{t('mail.testSent', { to: to.trim() })}</Alert>
      )}
      {result?.ok === false && <Alert severity="error">{result.message}</Alert>}
    </Box>
  );
}
