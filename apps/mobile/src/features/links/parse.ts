import type { Href } from "expo-router";

/** Where an accepted nohmi web link opens in the app. */
export type NativeLink =
  | { kind: "screen"; href: Href }
  /** Mail has no conversation route; the shell reads the conversation and shows the reader. */
  | { kind: "conversation"; id: string }
  /** A web link the app was handed but has no screen for. */
  | { kind: "unsupported" };

type LinkRoute = { path: string; param: string; open: (id: string) => NativeLink };
const screen = (pathname: string, params: Record<string, string>): NativeLink => ({
  kind: "screen",
  href: { pathname, params } as Href,
});

/**
 * The record links the web app writes and this app opens. The hosted association file
 * (`apps/web/public/.well-known/apple-app-site-association`) claims exactly these, so a link to
 * anything else stays in the browser.
 */
export const linkRoutes: readonly LinkRoute[] = [
  { path: "/tasks", param: "task", open: (id) => screen("/task-editor", { id, kind: "task" }) },
  {
    path: "/reminders",
    param: "reminder",
    open: (id) => screen("/task-editor", { id, kind: "reminder" }),
  },
  {
    path: "/finances/transactions",
    param: "transactionId",
    open: (id) => screen("/finance-transaction", { id }),
  },
  { path: "/calendar", param: "event", open: (id) => screen("/calendar-event", { id }) },
  { path: "/mail", param: "thread", open: (id) => ({ kind: "conversation", id }) },
];

/** Record ids are opaque; anything that could not be one is not passed to a screen. */
const recordId = /^[\w.:-]{1,200}$/;

/**
 * Links that only bring the person back to a flow already open in the app, such as a bank
 * sign-in returning to the Plaid SDK (COO-234). The app opens no screen for them and never
 * reads, stores or logs their parameters; the native SDK that started the flow resumes it.
 */
export const handoffPaths: readonly string[] = ["/plaid/return"];

function ownLink(url: string, appOrigin: string) {
  let link: URL;
  try {
    link = new URL(url);
  } catch {
    return null;
  }
  return link.origin === appOrigin && !link.username && !link.password ? link : null;
}
const pathOf = (link: URL) => link.pathname.replace(/\/+$/, "") || "/";

export function isHandoffLink(url: string, appOrigin: string) {
  const link = ownLink(url, appOrigin);
  return !!link && handoffPaths.includes(pathOf(link));
}

export const isWebLink = (url: string) => /^https?:\/\//i.test(url);

/**
 * Maps a nohmi web link to its native destination, or null when the link is not one this app
 * opens: another origin, credentials in the URL, an unknown path, or a missing or malformed id.
 */
export function nativeLink(url: string, appOrigin: string): NativeLink | null {
  const link = ownLink(url, appOrigin);
  if (!link) return null;
  const path = pathOf(link);
  const route = linkRoutes.find((candidate) => candidate.path === path);
  if (!route) return null;
  const ids = link.searchParams.getAll(route.param);
  const id = ids[0];
  return ids.length === 1 && id && recordId.test(id) ? route.open(id) : null;
}
