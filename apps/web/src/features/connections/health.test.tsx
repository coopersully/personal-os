// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ConnectedAccountHealth } from "@personal-os/domain";
import { render, screen } from "@testing-library/react";
import {
  ConnectionHealthBadge,
  ConnectionHealthDescription,
  ConnectionRecoveryAlert,
  connectionHealth,
  visibleConnectorRefreshInterval,
} from "./health.js";

const baseHealth: ConnectedAccountHealth = {
  message: null,
  nextSyncAt: null,
  recovery: null,
  state: "ready",
};

describe("connection health presentation", () => {
  it.each([
    ["ready", "Ready"],
    ["syncing", "Syncing"],
    ["retrying", "Retrying automatically"],
    ["reconnect", "Reconnect required"],
    ["service_attention", "ilo is resolving this"],
  ] as const)("renders %s as %s", (state, label) => {
    render(<ConnectionHealthBadge health={{ ...baseHealth, state }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("explains automatic retry timing and ready freshness", () => {
    const { rerender } = render(
      <ConnectionHealthDescription
        health={{
          message: "Google is temporarily unavailable. ilo will retry automatically.",
          nextSyncAt: "2026-08-05T20:05:00.000Z",
          recovery: "automatic",
          state: "retrying",
        }}
        lastSyncedAt="2026-08-05T19:55:00.000Z"
        now={Date.parse("2026-08-05T20:00:00.000Z")}
      />,
    );
    expect(screen.getByText(/Next attempt in 5 minutes/u)).toBeInTheDocument();
    rerender(
      <ConnectionHealthDescription
        health={baseHealth}
        lastSyncedAt="2026-08-05T19:55:00.000Z"
        now={Date.parse("2026-08-05T20:00:00.000Z")}
      />,
    );
    expect(screen.getByText(/Synced 5 minutes ago/u)).toBeInTheDocument();
  });

  it("links reconnecting accounts directly to Connections without raw provider material", () => {
    render(
      <ConnectionRecoveryAlert
        accounts={[
          {
            health: {
              message: "Google authorization is no longer valid. Reconnect to resume syncing.",
              nextSyncAt: null,
              recovery: "reconnect",
              state: "reconnect",
            },
            id: "account-1",
            label: "Personal Google",
          },
        ]}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Personal Google");
    expect(screen.getByRole("link", { name: "Review connections" })).toHaveAttribute(
      "href",
      "/settings?section=connections",
    );
    expect(screen.queryByText(/raw-provider-canary/u)).not.toBeInTheDocument();
  });

  it("uses safe descriptions for every incomplete health payload", () => {
    const { rerender } = render(
      <ConnectionHealthDescription
        health={{ ...baseHealth, state: "syncing" }}
        lastSyncedAt={null}
      />,
    );
    expect(screen.getByText("Sync in progress.")).toBeInTheDocument();

    rerender(
      <ConnectionHealthDescription
        health={{ ...baseHealth, recovery: "automatic", state: "retrying" }}
        lastSyncedAt={null}
      />,
    );
    expect(screen.getByText("This connection is temporarily unavailable.")).toBeInTheDocument();

    rerender(
      <ConnectionHealthDescription
        health={{ ...baseHealth, recovery: "reconnect", state: "reconnect" }}
        lastSyncedAt={null}
      />,
    );
    expect(screen.getByText("Reconnect this account to resume syncing.")).toBeInTheDocument();

    rerender(
      <ConnectionHealthDescription
        health={{ ...baseHealth, recovery: "operator", state: "service_attention" }}
        lastSyncedAt={null}
      />,
    );
    expect(screen.getByText("ilo is resolving a connection issue.")).toBeInTheDocument();

    rerender(<ConnectionHealthDescription health={baseHealth} lastSyncedAt={null} />);
    expect(screen.getByText("Ready to sync")).toBeInTheDocument();
  });

  it("summarizes multiple reconnects and omits the alert when none need authorization", () => {
    const reconnect = {
      health: { ...baseHealth, recovery: "reconnect" as const, state: "reconnect" as const },
      id: "account-1",
      label: "Personal Google",
    };
    const { rerender } = render(
      <ConnectionRecoveryAlert
        accounts={[reconnect, { ...reconnect, id: "account-2", label: "Work Google" }]}
      />,
    );
    expect(screen.getByText("Reconnect accounts")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Personal Google, Work Google");

    rerender(<ConnectionRecoveryAlert accounts={[]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("projects legacy account states without exposing legacy error details", () => {
    expect(connectionHealth({ health: baseHealth, syncStatus: "error" })).toBe(baseHealth);
    expect(connectionHealth({ syncStatus: "syncing" })).toMatchObject({ state: "syncing" });
    expect(connectionHealth({ syncStatus: "error" })).toMatchObject({
      message: "This connection needs attention. ilo is resolving this.",
      state: "service_attention",
    });
    expect(connectionHealth({ syncStatus: "idle" })).toMatchObject({ state: "ready" });
  });

  it("refreshes only while connection health is visible", () => {
    const visibility = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    expect(visibleConnectorRefreshInterval()).toBe(30_000);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    expect(visibleConnectorRefreshInterval()).toBe(false);
    if (visibility) Object.defineProperty(Document.prototype, "visibilityState", visibility);
    Reflect.deleteProperty(document, "visibilityState");
  });
});
