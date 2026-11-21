// MUI's own strings follow the language the app speaks (PL-148).
import { describe, expect, it } from 'vitest';
import { createAppTheme, muiLocaleFor } from './theme.ts';

const noOptions = (language?: string) =>
  createAppTheme('light', {}, 0, language).components?.MuiAutocomplete?.defaultProps?.noOptionsText;

describe('theme: MUI strings', () => {
  it('speaks each drafted language, and English otherwise', () => {
    expect(noOptions('de')).toBe('Keine Optionen');
    expect(noOptions('es')).toBe('Sin opciones');
    expect(noOptions('fr')).toBe('Pas de résultats');
    // English is MUI's own default: its English locale sets nothing.
    expect(noOptions()).toBeUndefined();
    expect(noOptions('pt-BR')).toBeUndefined();
  });

  it('takes a regional tag by its base language', () => {
    expect(muiLocaleFor('de-AT')).toBe(muiLocaleFor('de'));
  });
});
