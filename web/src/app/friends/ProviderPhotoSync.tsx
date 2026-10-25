import { useEffect, useRef } from 'react';
import { setProfilePhoto } from '../../core/profile.ts';
import { useApply, useStoreState } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { squarePhoto } from './squarePhoto.ts';

/**
 * Brings in the identity provider's picture (spec: R-FB-62) when the signed-in person has no
 * photo of their own: the server passes it through, this shrinks it and keeps it on the profile.
 * Once a visit; a photo they set is never replaced.
 */
export function ProviderPhotoSync() {
  const account = useSyncState((state) => state.account);
  const apply = useApply();
  const hasPhoto = useStoreState((state) => {
    const me = account
      ? state.workspace?.entities.users.find((user) => user.id === account.id)
      : undefined;
    return me === undefined ? null : Boolean(me.photo);
  });
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || !account?.hasProviderPicture || hasPhoto !== false) return;
    tried.current = true;
    void (async () => {
      try {
        const response = await fetch('/api/account/provider-picture', {
          credentials: 'same-origin',
        });
        if (!response.ok) return;
        const photo = await squarePhoto(await response.blob());
        if (photo) apply((ctx, ws) => setProfilePhoto(ctx, ws, photo));
      } catch {
        // No picture this time: initials.
      }
    })();
  }, [account, hasPhoto, apply]);
  return null;
}
