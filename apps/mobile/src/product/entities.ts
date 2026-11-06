import type { IconName } from "../components/icons";
/** Entity identity is independent of workspace, route, selection and field wording. */
export const entityDictionary = {
  list: { label: "List", icon: "views" },
  project: { label: "Project", icon: "target" },
} as const satisfies Record<string, { label: string; icon: IconName }>;
export type EntityKind = keyof typeof entityDictionary;
