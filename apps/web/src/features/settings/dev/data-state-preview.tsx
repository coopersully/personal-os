import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

const emptyResponses: Record<string, unknown> = {
  "/v1/rituals/history": { items: [], total: 0, nextCursor: null },
  "/v1/goals": { goals: [] },
  "/v1/motives": { motives: [] },
  "/v1/audit": { events: [] },
  "/v1/connectors": { accounts: [] },
  "/v1/calendars": { calendars: [] },
  "/v1/sessions": { sessions: [] },
  "/v1/invitations": { invitations: [] },
  "/v1/oauth/clients": { clients: [] },
  "/v1/access-tokens": { tokens: [] },
  "/v1/mail/rules": { rules: [] },
  "/v1/mail/setup-context": null,
};

/** Local, development-only read fixtures. Auth and configuration are never simulated. */
export function settingsPreviewMode(url: URL) {
  if (
    !import.meta.env.DEV ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/settings"
  )
    return null;
  const mode = url.searchParams.get("dataState");
  return mode === "empty" || mode === "error" ? mode : null;
}

export const settingsDataPreviewFetch: typeof fetch = async (input, init) => {
  const page = new URL(window.location.href);
  const mode = settingsPreviewMode(page);
  const target = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    page,
  );
  if (!mode || target.origin !== page.origin) return globalThis.fetch(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  // Previewing absent data must never make it safe to overwrite existing data.
  if (method !== "GET" && !target.pathname.startsWith("/v1/auth/")) {
    return Response.json(
      {
        error: {
          code: "preview_read_only",
          message: "Exit the data-state preview before making changes.",
        },
      },
      { status: 409 },
    );
  }
  // Keep the settings preview inspectable without completing, skipping, or snoozing a ritual.
  // Read the authoritative response first so authentication failures still propagate.
  if (method === "GET" && target.pathname === "/v1/rituals/current") {
    const response = await globalThis.fetch(input, init);
    if (!response.ok) return response;
    const state = await response.json();
    return Response.json({ ...state, current: null, upcoming: [] });
  }
  if (method !== "GET" || !(target.pathname in emptyResponses))
    return globalThis.fetch(input, init);
  if (mode === "empty" && target.pathname === "/v1/mail/setup-context") {
    const response = await globalThis.fetch(input, init);
    if (!response.ok) return response;
    const value = await response.json();
    return Response.json({ ...value, setup: { ...value.setup, accounts: [] } });
  }
  return mode === "empty"
    ? Response.json(emptyResponses[target.pathname])
    : Response.json(
        {
          error: { code: "preview_unavailable", message: "Simulated read failure for visual QA." },
        },
        { status: 503 },
      );
};

export function SettingsDataStateNotice() {
  const location = useLocation();
  const current = new URL(`${location.pathname}${location.search}`, window.location.origin);
  const mode = settingsPreviewMode(current);
  if (!mode) return null;
  current.searchParams.delete("dataState");
  return (
    <aside
      aria-label="Data-state preview"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
    >
      <span>
        Development preview: {mode === "empty" ? "empty collections" : "unavailable collections"}.
        Ritual overlay hidden. Record changes are blocked.
      </span>
      <Button asChild size="sm" variant="secondary">
        <a href={`${current.pathname}${current.search}`}>Exit preview</a>
      </Button>
    </aside>
  );
}
