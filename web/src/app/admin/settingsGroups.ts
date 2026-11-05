/** Which page each group of settings is on. Anything else is on General. */
export const SETTINGS_ON = {
  signIn: (group: string) => group === 'sign-in' || group.startsWith('provider:'),
  email: (group: string) => group === 'email',
  backups: (group: string) => group === 'backups',
  logs: (group: string) => ['logging', 'audit', 'log-shipping'].includes(group),
  general: (group: string) =>
    !SETTINGS_ON.signIn(group) &&
    !SETTINGS_ON.email(group) &&
    !SETTINGS_ON.backups(group) &&
    !SETTINGS_ON.logs(group),
};
