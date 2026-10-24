import type { CapacitorConfig } from '@capacitor/cli';

// The Android shell (ADR-0017). With no server chosen it runs the bundled web build standalone;
// once the person connects to a server, MainActivity points the WebView at that server instead, so
// the app always runs the web build its server ships. `server.url` is set at runtime, never here.
const config: CapacitorConfig = {
  appId: 'com.killswitch10.punchlist',
  appName: 'Punchlist',
  webDir: '../web/dist',
  android: {
    // Matches the PWA manifest's background, so no white flash before the app paints.
    backgroundColor: '#FAFAF7',
  },
};

export default config;
