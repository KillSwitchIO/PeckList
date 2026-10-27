import { Alert, type SxProps, type Theme } from '@mui/material';

/** What went wrong with the last thing the person tried, under the form; nothing when all is well. */
export function ProblemAlert({ problem, sx }: { problem: string | null; sx?: SxProps<Theme> }) {
  if (!problem) return null;
  return (
    <Alert severity="error" variant="outlined" sx={sx}>
      {problem}
    </Alert>
  );
}
