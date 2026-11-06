import type { CapacitorConfig } from '@capacitor/cli';

// The Android shell (ADR-0017). With no server chosen it runs the bundled web build standalone;
// once the person connects to a server, MainActivity points the WebView at that server instead, so
// the app always runs the web build its server ships. `server.url` is set at runtime, never here.
const config: CapacitorConfig = {
  appId: 'com.killswitch10.pecklist',
  appName: 'PeckList',
  webDir: '../web/dist',
  android: {
    // Matches the PWA manifest's background, so no white flash before the app paints.
    backgroundColor: '#FAFAF7',
  },
  plugins: {
    // MainActivity keeps the WebView clear of the status and navigation bars itself, so a server's
    // older web build lays out right too.
    SystemBars: {
      insetsHandling: 'disable',
    },
    // Reminders (web/src/adapters/capacitor-notifier.ts): our status bar icon, in the accent.
    LocalNotifications: {
      smallIcon: 'ic_stat_pecklist',
      iconColor: '#5A8A4E',
    },
  },
};

export default config;
