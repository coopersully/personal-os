import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import { geistFontUrls } from "./web-host/font-urls.mjs";

// Metro runs PostCSS for the web target. Tailwind scans the shared web UI it styles, which lives
// in apps/web; the native app does not use Tailwind.
export default {
  plugins: [
    tailwindcss({ base: fileURLToPath(new URL("../web", import.meta.url)) }),
    geistFontUrls,
  ],
};
