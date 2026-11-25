import { ExpoWebHost } from "@personal-os/web/expo-host";

// On web the Expo project serves the full nohmi web UI from the shared apps/web source. The
// native screens under this directory remain the iOS experience; their web previews are not
// rendered. Web routing still belongs to the web UI's React Router tree until each workspace
// moves onto Expo Router (see docs/engineering/expo-web-migration.md).
export default function WebRootLayout() {
  return <ExpoWebHost />;
}
