import { IconButton, InputAdornment, TextField, type TextFieldProps } from '@mui/material';
import { useState } from 'react';
import { t } from '../i18n/i18n.ts';
import { EyeIcon, EyeOffIcon } from '../icons/icons.tsx';

/**
 * A password (or other secret) field with an eye at its right end that shows what was typed, to
 * check it before sending (spec: R-FB-51). Hidden again on every visit.
 */
export function PasswordField({ slotProps, ...props }: Omit<TextFieldProps, 'type'>) {
  const [shown, setShown] = useState(false);
  const input = (slotProps?.input ?? {}) as Record<string, unknown>;
  return (
    <TextField
      {...props}
      type={shown ? 'text' : 'password'}
      slotProps={{
        ...slotProps,
        input: {
          ...input,
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                edge="end"
                size="small"
                aria-label={shown ? t('auth.hidePassword') : t('auth.showPassword')}
                aria-pressed={shown}
                // Keep the caret in the field.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setShown((now) => !now)}
                disabled={props.disabled}
              >
                {shown ? <EyeOffIcon fontSize="small" /> : <EyeIcon fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
