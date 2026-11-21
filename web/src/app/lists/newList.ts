import { localTimeZone } from '../../core/dates.ts';
import { createList, updateList } from '../../core/lists.ts';
import type { OpContext } from '../../core/ops.ts';
import { fromListTemplate } from '../../core/templates.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import type { ListFormValue } from './ListDialog.tsx';

/** The new list dialog's list: a plain one, or one from a list template with its tasks (PL-140). */
export function makeList(
  ctx: OpContext,
  workspace: WorkspaceFile,
  value: ListFormValue,
  today: string,
): { workspace: WorkspaceFile; listId: string } {
  if (!value.templateId) {
    const made = createList(ctx, workspace, value);
    return { workspace: made.workspace, listId: made.list.id };
  }
  const made = fromListTemplate(ctx, workspace, value.templateId, value.name, {
    day: today,
    timeZone: localTimeZone(),
  });
  // The look as the form left it: it may have been changed after the template filled it.
  return {
    workspace: updateList(ctx, made.workspace, made.listId, {
      color: value.color,
      icon: value.icon,
    }),
    listId: made.listId,
  };
}
