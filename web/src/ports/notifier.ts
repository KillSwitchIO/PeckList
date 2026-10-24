/** System notifications (spec: PL-061): the browser's today, native ones later. */
export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export interface AppNotification {
  title: string;
  body: string;
  /** One notification per tag: showing the same tag again replaces it (across tabs too). */
  tag: string;
  /** Where a click goes, inside the app. */
  url: string;
}

export interface Notifier {
  permission(): NotificationPermissionState;
  /** Ask once (only from a click or a key press, or browsers ignore it). */
  request(): Promise<NotificationPermissionState>;
  show(notification: AppNotification): Promise<void>;
}
