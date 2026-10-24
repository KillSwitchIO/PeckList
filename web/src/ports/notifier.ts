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

/** This browser's Web Push subscription, as the server stores it. */
export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** The browser's side of Web Push (spec: PL-061). */
export interface BrowserPush {
  /** Whether this browser can take pushes (an installed app on iPhone and iPad). */
  supported(): boolean;
  current(): Promise<PushSubscriptionData | null>;
  /** Subscribe with the server's key; asks for notification permission first. */
  subscribe(publicKey: string): Promise<PushSubscriptionData>;
  /** Unsubscribe; the endpoint it had, if any. */
  unsubscribe(): Promise<string | null>;
}
