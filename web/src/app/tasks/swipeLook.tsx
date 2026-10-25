import CheckRounded from '@mui/icons-material/CheckRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import { t } from '../i18n/i18n.ts';
import { CalendarIcon, PinIcon, PinOffIcon, WontDoIcon } from '../icons/icons.tsx';
import type { SwipeAction } from './swipePrefs.ts';

/** What each action looks like on a row: its words, its icon, its color. */
export function swipeLook(action: SwipeAction, state: { done: boolean; pinned: boolean }) {
  switch (action) {
    case 'complete':
      return state.done
        ? { label: t('swipe.reopen'), icon: <ReplayRounded />, color: 'primary' }
        : { label: t('swipe.complete'), icon: <CheckRounded />, color: 'primary' };
    case 'date':
      return { label: t('swipe.date'), icon: <CalendarIcon />, color: 'warning' };
    case 'move':
      return { label: t('swipe.move'), icon: <DriveFileMoveOutlined />, color: 'info' };
    case 'pin':
      return state.pinned
        ? { label: t('swipe.unpin'), icon: <PinOffIcon />, color: 'secondary' }
        : { label: t('swipe.pin'), icon: <PinIcon />, color: 'secondary' };
    case 'wontDo':
      return { label: t('swipe.wontDo'), icon: <WontDoIcon />, color: 'grey' };
    case 'delete':
      return { label: t('swipe.delete'), icon: <DeleteOutlineRounded />, color: 'error' };
  }
}
