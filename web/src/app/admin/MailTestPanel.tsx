// Send test email (PL-122), under the Email settings: an address, a button, and what the mail
// server answered. Uses the settings as they apply now, so save first.

import { Alert, Box, Button, TextField } from '@mui/material';
import { useState } from 'react';
import type { AdminApi } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';

export function MailTestPanel({ api }: { api: AdminApi }) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true } | { ok: false; message: string } | null>(null);
  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await api.sendTestMail(to.trim()));
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
          {t('mail.sendTest')}
        </Button>
      </Box>
      {result?.ok === true && (
        <Alert severity="success">{t('mail.testSent', { to: to.trim() })}</Alert>
      )}
      {result?.ok === false && <Alert severity="error">{result.message}</Alert>}
    </Box>
  );
}
