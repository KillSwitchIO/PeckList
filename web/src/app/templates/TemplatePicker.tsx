import SearchRounded from '@mui/icons-material/SearchRounded';
import { Box, Button, ButtonBase, InputBase, Typography } from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { templatesByUse } from '../../core/templates.ts';
import type { Template } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { useToday } from '../hooks/useToday.ts';
import { useWorkspace } from '../store/hooks.ts';
import { PropertySheet } from '../tasks/PropertyRow.tsx';
import { templateSummary } from './templateSummary.ts';

/**
 * Pick a template (PL-140): a search field and the templates of one kind, most used first, then
 * Manage templates. A popover by what opened it, a bottom sheet on phones.
 */
export function TemplatePicker({
  kind,
  anchor,
  onClose,
  onPick,
}: {
  kind: Template['kind'];
  anchor: HTMLElement | null;
  onClose: () => void;
  onPick: (template: Template) => void;
}) {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const today = useToday();
  const [query, setQuery] = useState('');
  const all = templatesByUse(workspace, kind);
  const wanted = query.trim().toLocaleLowerCase();
  const shown = wanted
    ? all.filter((template) => template.name.toLocaleLowerCase().includes(wanted))
    : all;
  const label = kind === 'task' ? t('templates.pickTask') : t('templates.pickList');
  return (
    <PropertySheet label={label} anchor={anchor} onClose={onClose}>
      <Box sx={{ width: { xs: '100%', sm: 300 }, py: 1 }}>
        {all.length > 0 && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              mx: 1.5,
              mb: 0.5,
              px: 1,
              py: 0.5,
              borderRadius: 1.5,
              bgcolor: 'action.hover',
              color: 'text.secondary',
            }}
          >
            <SearchRounded sx={{ fontSize: 18 }} />
            <InputBase
              autoFocus
              fullWidth
              value={query}
              placeholder={t('templates.search')}
              inputProps={{ 'aria-label': t('templates.search') }}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && shown[0]) {
                  event.preventDefault();
                  onPick(shown[0]);
                }
              }}
              sx={{ color: 'text.primary', fontSize: '0.875rem' }}
            />
          </Box>
        )}
        <Box
          component="ul"
          aria-label={label}
          sx={{ listStyle: 'none', m: 0, p: 0, maxHeight: 320, overflowY: 'auto' }}
        >
          {shown.map((template) => (
            <li key={template.id}>
              <ButtonBase
                onClick={() => onPick(template)}
                sx={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  px: 2,
                  py: 0.75,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Typography noWrap>{template.name}</Typography>
                <Typography noWrap variant="caption" color="text.secondary" component="div">
                  {templateSummary(template, today)}
                </Typography>
              </ButtonBase>
            </li>
          ))}
        </Box>
        {all.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
            {t('templates.empty')}
          </Typography>
        )}
        {all.length > 0 && shown.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
            {t('templates.noMatch')}
          </Typography>
        )}
        <Box sx={{ px: 1, pt: 0.5, borderTop: 1, borderColor: 'divider', mt: 0.5 }}>
          <Button
            size="small"
            onClick={() => {
              onClose();
              void navigate('/templates');
            }}
          >
            {t('templates.manage')}
          </Button>
        </Box>
      </Box>
    </PropertySheet>
  );
}
