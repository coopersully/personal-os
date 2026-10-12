import type { Icon } from "../components/icons.js";

export type MobileWorkspacePage = {
  badge?: string;
  count?: number | undefined;
  icon: Icon;
  label: string;
  path: string;
};
