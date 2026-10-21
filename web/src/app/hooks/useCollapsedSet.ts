import { useCallback, useState } from 'react';

// Which tree items are collapsed is a per-browser convenience: losing it (private window,
// cleared storage) only means everything shows expanded again.
function load(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function save(key: string, ids: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // storage unavailable; keep the in-memory state only
  }
}

/** A set of collapsed ids remembered in this browser under `key`. */
export function useCollapsedSet(key: string): {
  collapsed: Set<string>;
  toggle: (id: string) => void;
} {
  const [collapsed, setCollapsed] = useState(() => load(key));
  const toggle = useCallback(
    (id: string) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        save(key, next);
        return next;
      }),
    [key],
  );
  return { collapsed, toggle };
}

/** Drop items under a collapsed parent from a flattened tree (parents come before children). */
export function withoutCollapsed<T>(
  nodes: T[],
  idOf: (node: T) => string,
  parentOf: (node: T) => string | null,
  collapsed: Set<string>,
): T[] {
  const hidden = new Set<string>();
  return nodes.filter((node) => {
    const parent = parentOf(node);
    if (parent && (hidden.has(parent) || collapsed.has(parent))) {
      hidden.add(idOf(node));
      return false;
    }
    return true;
  });
}
