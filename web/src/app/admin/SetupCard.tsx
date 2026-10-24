import { Alert, Button } from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { AdminApi } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';

/** Offers the first-run wizard on the admin page until it is finished or dismissed. */
export function SetupCard({ api }: { api: AdminApi }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    api.setup().then(
      (state) => live && setOpen(!state.done),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (!open) return null;
  return (
    <Alert
      severity="info"
      variant="outlined"
      sx={{ mb: 2 }}
      action={
        <>
          <Button color="inherit" size="small" onClick={() => void navigate('/admin/setup')}>
            {t('setup.open')}
          </Button>
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              setOpen(false);
              void api.finishSetup();
            }}
          >
            {t('setup.dismiss')}
          </Button>
        </>
      }
    >
      <strong>{t('setup.cardTitle')}</strong> {t('setup.cardText')}
    </Alert>
  );
}
