import "./styles.css";
import { prepareWebDocument, WebRoot } from "./web-root.js";

// The Expo web target owns the document; apply the same pre-paint classes as the Vite entry.
prepareWebDocument();

/** Renders the web UI inside the Expo project's web target. Not used by the Vite PWA. */
export function ExpoWebHost() {
  return <WebRoot />;
}
