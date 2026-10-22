/** Canonical Settings hierarchy; all navigation and search links use this contract. */
export const settingsParents: Record<string, string> = {
  setup: "profile",
  "ritual-morning": "rituals",
  "ritual-evening": "rituals",
  "ritual-history": "rituals",
  "completed-outcomes": "goals",
  "agent-connections": "connections",
  "workspace-access": "security",
  sessions: "security",
  invitations: "security",
};
export function settingsPath(section: string): string {
  if (section === "ritual-data") section = "rituals";
  if (section === "motives") section = "goals";
  const parent = settingsParents[section];
  const params = new URLSearchParams({ page: parent ?? section });
  if (parent) params.set("subpage", section);
  return `/settings?${params}`;
}
export function settingsRoute(search: string): string {
  const params = new URLSearchParams(search);
  if (params.get("subpage") === "ritual-data" || params.get("section") === "ritual-data") return "rituals";
  const page = params.get("page");
  const subpage = params.get("subpage");
  if (page === "motives" || (!page && params.get("section") === "motives")) return "goals";
  if (page) return subpage && settingsParents[subpage] === page ? subpage : page;
  return params.get("section") ?? "profile";
}
