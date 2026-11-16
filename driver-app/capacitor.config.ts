import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Placeholder ID until the platform has a name. Changing it later means a fresh install.
  appId: "com.taxidispatch.driver",
  appName: "Driver",
  webDir: "dist",
  server: {
    androidScheme: "https",
    // Lets the demo talk to a server on plain http:// (e.g. a laptop on the same Wi-Fi).
    // Turn off before go-live.
    cleartext: true,
  },
  android: {
    // Needed by the background location plugin, otherwise updates stop after ~5 minutes.
    useLegacyBridge: true,
  },
};

export default config;
