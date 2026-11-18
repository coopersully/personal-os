import type { Icon } from "../components/icons.js";

export type MobileWorkspacePage = {
  id: string;
  kind?: "section" | "destination";
  icon: Icon;
  label: string;
  path: string;
};
