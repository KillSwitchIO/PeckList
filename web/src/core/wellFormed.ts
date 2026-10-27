// Text holding half of a surrogate pair (an emoji cut in two, usually by an import) is not valid
// Unicode: the server cannot store it and refused the whole sync it came in (R-FB-94). Such text
// is put right here, as an ordinary edit, so every copy ends up with the same text.

import { updateEntity, type OpContext, type Patch } from './ops.ts';
import { COLLECTIONS, type BaseEntity, type WorkspaceFile } from './types.ts';

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** `text` with each half of a surrogate pair standing alone replaced by U+FFFD. */
export function wellFormed(text: string): string {
  return text.replace(LONE, '�');
}

/** The workspace with every entity's text fields well formed (the same object when they are). */
export function repairText(ctx: OpContext, workspace: WorkspaceFile): WorkspaceFile {
  let entities: WorkspaceFile['entities'] | null = null;
  for (const collection of COLLECTIONS) {
    const list = workspace.entities[collection] as BaseEntity[];
    let fixed: BaseEntity[] | null = null;
    list.forEach((entity, index) => {
      const patch: Record<string, string> = {};
      for (const [key, value] of Object.entries(entity)) {
        if (key === 'id' || typeof value !== 'string') continue;
        const good = wellFormed(value);
        if (good !== value) patch[key] = good;
      }
      if (Object.keys(patch).length === 0) return;
      fixed ??= [...list];
      fixed[index] = updateEntity(ctx, entity, patch as Patch<BaseEntity>);
    });
    if (fixed) {
      entities ??= { ...workspace.entities };
      (entities as Record<string, BaseEntity[]>)[collection] = fixed;
    }
  }
  return entities ? { ...workspace, entities } : workspace;
}
