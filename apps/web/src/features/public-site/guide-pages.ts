export const guidePages = [
  { slug: "docs", label: "start here" },
  { slug: "docs/today", label: "today" },
  { slug: "docs/mail", label: "mail" },
  { slug: "docs/tasks", label: "tasks" },
  { slug: "docs/calendar", label: "calendar" },
  { slug: "docs/finances", label: "finances" },
  { slug: "docs/agents", label: "agents and permissions" },
] as const;
export const guideSlugs = guidePages.map(({ slug }) => slug);
