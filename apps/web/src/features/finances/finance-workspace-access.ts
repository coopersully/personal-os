/** Navigation context only. Domain authorization is always enforced by the server. */
export type FinanceSetupTask = "correct" | "import" | "approve";

export function safeFinanceReturnTo(raw: string | null | undefined): string {
  if (!raw || raw.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(raw)) return "/finances";
  try {
    const url = new URL(raw, "https://finance.invalid");
    if (
      !raw.startsWith("/finances") ||
      url.origin !== "https://finance.invalid" ||
      !(url.pathname === "/finances" || url.pathname.startsWith("/finances/")) ||
      url.pathname === "/finances/setup"
    )
      return "/finances";
    // Decode once to reject encoded path separators or a disguised setup loop.
    const path = decodeURIComponent(url.pathname);
    if (
      path.includes("\\") ||
      path.includes("//") ||
      /[\u0000-\u0020\u007f]/.test(path) ||
      path === "/finances/setup"
    )
      return "/finances";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/finances";
  }
}

export function financeSetupTask(pathname: string, search: string): FinanceSetupTask | null {
  const task = new URLSearchParams(search).get("financeTask");
  if (pathname === "/finances/transactions" && (task === "correct" || task === "import"))
    return task;
  if ((pathname === "/finances/plan" || pathname === "/finances/budgets") && task === "approve")
    return task;
  return null;
}

export function financeRouteNeedsSetup(pathname: string, search: string): boolean {
  if (financeSetupTask(pathname, search)) return false;
  const [, , section] = pathname.split("/");
  // These are explicit repair, evidence, question and approval destinations.
  return ![
    "setup",
    "accounts",
    "profile",
    "chat",
    "automations",
    "activity",
    "review",
    "reviews",
    "exports",
    "health",
  ].includes(section ?? "");
}
