import type { WorkspaceFile } from '../../core/types.ts';
import { serializeWorkspace } from '../../core/workspace.ts';

/** `pecklist-2026-10-23.json`, by this device's date. */
export function exportFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `pecklist-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** Download everything on this device as one JSON file (Settings > Your data, and before starting over). */
export function downloadWorkspace(workspace: WorkspaceFile): void {
  const blob = new Blob([serializeWorkspace(workspace)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFileName();
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
