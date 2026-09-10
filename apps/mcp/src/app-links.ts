import type { IloToolDefinition } from "./tool-catalog.js";

export type IloAppLinks = {
  activity: string;
  agentAccess: string;
  approvals: string;
  recovery: string;
  today: string;
};

export function resolveAppBaseUrl(
  environment: { APP_BASE_URL?: string },
  options: { production: boolean },
): string {
  const configured = environment.APP_BASE_URL?.trim();
  if (!configured) throw new Error("APP_BASE_URL must be configured explicitly.");

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("APP_BASE_URL must be an absolute HTTP(S) origin.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("APP_BASE_URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("APP_BASE_URL must not contain credentials.");
  }
  if (url.search) throw new Error("APP_BASE_URL must not contain a query string.");
  if (url.hash) throw new Error("APP_BASE_URL must not contain a fragment.");
  if (url.pathname !== "/") throw new Error("APP_BASE_URL must be an origin without a path.");
  if (options.production && url.protocol !== "https:") {
    throw new Error("APP_BASE_URL must use https in production.");
  }
  if (
    options.production &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
  ) {
    throw new Error("APP_BASE_URL must not use localhost in production.");
  }
  return url.origin;
}

export function createIloAppLinks(
  appBaseUrl: string,
  domain: IloToolDefinition["domain"],
): IloAppLinks {
  const approvalPath =
    {
      activity: "/activity",
      assistant: "/reviews",
      calendar: "/calendar",
      finances: "/finances/review",
      goals: "/goals",
      mail: "/mail",
      reminders: "/tasks",
      tasks: "/tasks",
      today: "/today",
    }[domain] ?? "/reviews";
  const link = (path: string) => new URL(path, `${appBaseUrl}/`).toString();
  return {
    activity: link("/activity"),
    agentAccess: link("/settings?section=workspace-access"),
    approvals: link(approvalPath),
    recovery: link("/settings?section=connections"),
    today: link("/today"),
  };
}
