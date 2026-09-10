import type { FinancePresentation, FinancePresentationKind } from "@personal-os/domain";
import { JSDOM } from "jsdom";
import { financePresentationDocuments } from "./presentation-resources.js";

type OpenPresentation = {
  document: Document;
  messages: Array<Record<string, unknown>>;
  sendHostContext(theme: "dark" | "light"): void;
  sendResult(presentation: FinancePresentation): void;
  teardown(id: string): void;
};

function openPresentation(kind: FinancePresentationKind): OpenPresentation {
  const messages: Array<Record<string, unknown>> = [];
  const dom = new JSDOM(financePresentationDocuments[kind], {
    beforeParse(window) {
      Object.defineProperty(window, "parent", {
        value: { postMessage: (message: Record<string, unknown>) => messages.push(message) },
      });
      Object.defineProperty(window, "ResizeObserver", {
        value: class ResizeObserver {
          constructor(private readonly callback: () => void) {}
          observe() {
            this.callback();
          }
          disconnect() {}
          unobserve() {}
        },
      });
      window.requestAnimationFrame = (callback) => {
        callback(0);
        return 1;
      };
    },
    runScripts: "dangerously",
  });
  const send = (data: Record<string, unknown>) => {
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", {
        data,
        source: dom.window.parent,
      }),
    );
  };
  const initialize = messages.find((message) => message.method === "ui/initialize");
  if (!initialize?.id) throw new Error(`The ${kind} app did not initialize.`);
  send({
    id: initialize.id,
    jsonrpc: "2.0",
    result: { hostCapabilities: { openLinks: {} }, hostContext: { theme: "light" } },
  });
  return {
    document: dom.window.document,
    messages,
    sendHostContext(theme) {
      send({
        jsonrpc: "2.0",
        method: "ui/notifications/host-context-changed",
        params: { theme },
      });
    },
    sendResult(presentation) {
      send({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: {
          structuredContent: {
            _ilo: {
              links: {
                approvals: "https://app.example.com/reviews",
              },
            },
            presentation,
          },
        },
      });
    },
    teardown(id) {
      send({ id, jsonrpc: "2.0", method: "ui/resource-teardown", params: { reason: "test" } });
    },
  };
}

function shared() {
  return {
    destination: { href: "/finances", label: "Open Finances" },
    diagnosticFacts: [{ label: "Source", value: "Connected accounts" }],
    disclosures: [{ importance: "important" as const, message: "Review this information." }],
    eyebrow: "Finance",
    summary: "Grounded in current evidence.",
  };
}

function snapshotPresentationFixture(): Extract<FinancePresentation, { kind: "finance_snapshot" }> {
  return {
    ...shared(),
    asOf: "2026-08-28T12:00:00.000Z",
    kind: "finance_snapshot",
    position: { cash: 12_000, debt: 2_000, investments: null, netWorth: -1_250 },
    title: "Financial snapshot",
    trust: {
      gaps: ["Unresolved account ownership"],
      state: "partial",
      trustworthy: false,
    },
  };
}

function budgetPresentationFixture(): Extract<FinancePresentation, { kind: "finance_budget" }> {
  return {
    ...shared(),
    allocations: Array.from({ length: 500 }, (_, index) => ({
      amount: index + 1,
      description: index === 0 ? "Long-term retirement investing" : null,
      key: `Allocation ${index + 1}`,
      kind: "savings" as const,
    })),
    assumptions: ["Income remains stable."],
    balance: 0,
    expectedResources: 125_250,
    kind: "finance_budget",
    status: "proposed",
    title: "Monthly budget",
    totalAllocated: 125_250,
  };
}

function reviewPresentationFixture(): Extract<FinancePresentation, { kind: "finance_review" }> {
  return {
    ...shared(),
    evidenceCount: 2,
    impactAmount: 42.5,
    kind: "finance_review",
    prompt: "What did you purchase at CVS?",
    reason: "The merchant is ambiguous.",
    title: "A transaction needs your input",
  };
}

function periodPresentationFixture(): Extract<
  FinancePresentation,
  { kind: "finance_period_verification" }
> {
  return {
    ...shared(),
    cutoff: "2026-08-28T12:00:00.000Z",
    kind: "finance_period_verification",
    period: { end: "2026-08-28", start: "2026-08-01" },
    recommendations: Array.from({ length: 25 }, (_, index) => ({
      disposition: index === 0 ? ("needs_input" as const) : ("monitor" as const),
      recommendation: `Recommendation ${index + 1}`,
    })),
    status: "completed_with_questions",
    title: "Period verification",
    work: { approvals: 1, exceptions: 2, questions: 3, rulesAndActions: 4 },
  };
}

describe("Finance MCP presentation resources", () => {
  it("renders snapshot metrics and trust gaps instead of JSON", () => {
    const view = openPresentation("finance_snapshot");
    view.sendResult(snapshotPresentationFixture());

    expect(view.document.querySelector("h1")?.textContent).toBe("Financial snapshot");
    expect(view.document.querySelector("main")?.textContent).toContain("Net worth");
    expect(view.document.querySelector("main")?.textContent).toContain("-$1,250.00");
    expect(view.document.querySelector("main")?.textContent).toContain("Unavailable");
    expect(view.document.querySelector("main")?.textContent).toContain(
      "Unresolved account ownership",
    );
    expect(view.document.querySelector("main")?.textContent).not.toContain(
      '"kind":"finance_snapshot"',
    );
  });

  it("fails closed when the result kind does not match the resource", () => {
    const view = openPresentation("finance_budget");
    view.sendResult(snapshotPresentationFixture());

    expect(view.document.querySelector("main")?.textContent).toContain(
      "This result is available in chat.",
    );
    expect(view.document.querySelector("main")?.textContent).not.toContain("-$1,250.00");
  });

  it("fails closed for malformed data even when the presentation kind matches", () => {
    const view = openPresentation("finance_snapshot");
    view.sendResult({
      ...snapshotPresentationFixture(),
      position: undefined,
    } as unknown as FinancePresentation);

    expect(view.document.querySelector("main")?.textContent).toContain(
      "This result is available in chat.",
    );
    expect(view.document.querySelector("main")?.textContent).not.toContain("Net worth");
  });

  it("renders complete bounded allocation and recommendation lists", () => {
    const budget = openPresentation("finance_budget");
    budget.sendResult(budgetPresentationFixture());
    expect(budget.document.querySelectorAll("[data-allocation]")).toHaveLength(500);

    const period = openPresentation("finance_period_verification");
    period.sendResult(periodPresentationFixture());
    expect(period.document.querySelectorAll("[data-recommendation]")).toHaveLength(25);
  });

  it("renders critical information before optional closed diagnostics", () => {
    const view = openPresentation("finance_review");
    view.sendResult({
      ...reviewPresentationFixture(),
      disclosures: [{ importance: "critical", message: "Answer before categorizing." }],
    });

    const aside = view.document.querySelector("aside");
    const details = view.document.querySelector("details");
    const viewWindow = view.document.defaultView;
    if (!viewWindow) throw new Error("The presentation window is unavailable.");
    expect(aside?.textContent).toContain("Answer before categorizing.");
    expect(details?.open).toBe(false);
    expect(
      (aside?.compareDocumentPosition(details as Node) ?? 0) &
        viewWindow.Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses host theme, reports size, mediates links, and acknowledges teardown", () => {
    const view = openPresentation("finance_review");
    view.sendHostContext("dark");
    view.sendResult(reviewPresentationFixture());
    expect(view.document.documentElement.style.colorScheme).toBe("dark");
    expect(view.messages).toContainEqual(
      expect.objectContaining({ method: "ui/notifications/size-changed" }),
    );

    const link = view.document.querySelector("a");
    const viewWindow = view.document.defaultView;
    if (!viewWindow) throw new Error("The presentation window is unavailable.");
    expect(link?.getAttribute("href")).toBe("https://app.example.com/finances");
    link?.dispatchEvent(new viewWindow.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(view.messages).toContainEqual(
      expect.objectContaining({
        method: "ui/open-link",
        params: { url: "https://app.example.com/finances" },
      }),
    );

    view.teardown("teardown-1");
    expect(view.messages).toContainEqual({ id: "teardown-1", jsonrpc: "2.0", result: {} });
  });
});
