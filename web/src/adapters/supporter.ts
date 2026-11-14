import type { SupporterRefusal } from '../ports/sync.ts';

const REFUSALS: Record<string, SupporterRefusal> = {
  not_a_key: 'not-a-key',
  not_genuine: 'not-genuine',
  server_key: 'wrong-kind',
  person_key: 'wrong-kind',
};

/** The reason a 400 from a supporter key endpoint gives (PL-112), or null when it gives none the app knows. */
export async function supporterRefusal(response: Response): Promise<SupporterRefusal | null> {
  if (response.status !== 400) return null;
  try {
    return REFUSALS[((await response.json()) as { error?: string }).error ?? ''] ?? null;
  } catch {
    return null;
  }
}
