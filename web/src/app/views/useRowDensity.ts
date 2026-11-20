import { rowDensityOf, setRowDensity, type RowDensity } from '../../core/settings.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';

/** A view's Row size (`view:today` and the like), synced in settings.compactViews (schema 19). */
export function useRowDensity(viewId: string): {
  value: RowDensity;
  onChange: (next: RowDensity) => void;
} {
  const workspace = useWorkspace();
  const apply = useApply();
  return {
    value: rowDensityOf(workspace, viewId),
    onChange: (next) => apply((ctx, ws) => setRowDensity(ctx, ws, viewId, next)),
  };
}
