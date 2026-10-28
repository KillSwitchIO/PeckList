// Versions as people read them (R-FB-147, R-FB-148): whether this page is the one its server
// serves, and whether a release is newer than what runs here.

/** `v0.2.7+20261028` as `0.2.7+...` dropped: the version, without a leading v or build metadata. */
export function withoutBuild(version: string): string {
  return version.trim().replace(/^v/i, '').split('+')[0]!;
}

/** The release numbers of a version: `0.2.7-edge.d89f0541` is 0.2.7. Null when it is none. */
export function releaseOf(version: string | null | undefined): [number, number, number] | null {
  if (!version) return null;
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(withoutBuild(version));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** Whether release `latest` is newer than `current` (an edge build of 0.2.7 is not behind 0.2.7). */
export function isNewer(
  latest: string | null | undefined,
  current: string | null | undefined,
): boolean {
  const a = releaseOf(latest);
  const b = releaseOf(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

/** This page against its server: the same build, or another one (a page cached from before). */
export type PageStatus = 'same' | 'different';

export function pageStatus(page: string, server: string): PageStatus {
  return withoutBuild(page) === withoutBuild(server) ? 'same' : 'different';
}
