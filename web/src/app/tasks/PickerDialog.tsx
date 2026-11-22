import SearchRounded from '@mui/icons-material/SearchRounded';
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  InputBase,
  List,
  ListItemButton,
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';

/** The most matches a picker lists. */
export const MAX_RESULTS = 50;

/** Pick one thing out of a searched list: a search box, the matches, and Enter takes the first. */
export function PickerDialog<T>({
  title,
  searchLabel,
  emptyText,
  listLabel,
  matching,
  keyOf,
  render,
  onPick,
  onClose,
}: {
  title: string;
  searchLabel: string;
  emptyText: string;
  listLabel?: string;
  /** The candidates for what was typed (trimmed, lowercase; empty for all). */
  matching: (wanted: string) => T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  onPick: (item: T) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const found = matching(query.trim().toLowerCase());
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ pb: 1 }}>{title}</DialogTitle>
      <DialogContent sx={{ px: 1, pb: 1 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mx: 1,
            mb: 1,
            px: 1.5,
            py: 0.5,
            borderRadius: 2,
            bgcolor: 'action.hover',
            color: 'text.secondary',
          }}
        >
          <SearchRounded fontSize="small" />
          <InputBase
            autoFocus
            fullWidth
            value={query}
            placeholder={searchLabel}
            inputProps={{ 'aria-label': searchLabel }}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && found[0]) {
                event.preventDefault();
                onPick(found[0]);
              }
            }}
            sx={{ color: 'text.primary' }}
          />
        </Box>
        {found.length === 0 ? (
          <Typography color="text.secondary" sx={{ px: 2, py: 1 }}>
            {emptyText}
          </Typography>
        ) : (
          <List dense sx={{ maxHeight: 360, overflowY: 'auto' }} aria-label={listLabel}>
            {found.map((item) => (
              <ListItemButton
                key={keyOf(item)}
                onClick={() => onPick(item)}
                sx={{ borderRadius: 2 }}
              >
                {render(item)}
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}
