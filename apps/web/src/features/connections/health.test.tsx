// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ConnectedAccountHealth } from "@personal-os/domain";
import { render, screen } from "@testing-library/react";
import {
  ConnectionCapabilityHealth,
  ConnectionHealthBadge,
  ConnectionHealthDescription,
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
  it("shows independent capability state and freshness during an outage", () => {
    render(
      <ConnectionCapabilityHealth
        enabled={{ calendar: true, mail: true }}
        fallback={{ health: baseHealth, lastSyncedAt: null }}
        capabilities={{
          calendar: {
            health: {
              ...baseHealth,
              state: "reconnect",
              recovery: "reconnect",
              message: "Calendar needs permission.",
            },
            lastAttemptAt: "2026-10-11T12:00:00.000Z",
            lastSyncedAt: "2026-09-30T12:00:00.000Z",
            failureCount: 1,
            errorCode: "google_permission_missing",
            errorCategory: "authorization",
            status: 403,
          },
          mail: {
            health: baseHealth,
            lastAttemptAt: "2026-10-11T12:00:00.000Z",
            lastSyncedAt: "2026-10-11T12:00:00.000Z",
            failureCount: 0,
            errorCode: null,
            errorCategory: null,
            status: null,
          },
        }}
      />,
    );
    expect(screen.getByText("Calendar")).toBeInTheDocument();
    expect(screen.getByText("Mail")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Reconnect required")).toBeInTheDocument();
    expect(screen.getAllByText(/Last successful sync/)).toHaveLength(2);
  });

  it.each([
    ["ready", "Ready"],
    ["syncing", "Syncing"],
    ["retrying", "Retrying automatically"],
    ["reconnect", "Reconnect required"],
    ["service_attention", "Service issue"],
  ] as const)("renders %s as %s", (state, label) => {
    render(<ConnectionHealthBadge health={{ ...baseHealth, state }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("explains automatic retry timing and ready freshness", () => {
    const { rerender } = render(
      <ConnectionHealthDescription
        health={{
          message: "Google is temporarily unavailable. nohmi will retry automatically.",
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
    expect(screen.getByText("nohmi is resolving a connection issue.")).toBeInTheDocument();

    rerender(<ConnectionHealthDescription health={baseHealth} lastSyncedAt={null} />);
    expect(screen.getByText("Ready to sync")).toBeInTheDocument();
  });

  it("projects legacy account states without exposing legacy error details", () => {
    expect(connectionHealth({ health: baseHealth, syncStatus: "error" })).toBe(baseHealth);
    expect(connectionHealth({ syncStatus: "syncing" })).toMatchObject({ state: "syncing" });
    expect(connectionHealth({ syncStatus: "error" })).toMatchObject({
      message: "This connection needs attention. nohmi is resolving this.",
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
  it("shows an unsynced Mail-only account without inventing Calendar health or success", () => {
    render(
      <ConnectionCapabilityHealth
        enabled={{ calendar: false, mail: true }}
        fallback={{ health: baseHealth, lastSyncedAt: null }}
        capabilities={{
          mail: {
            lastAttemptAt: "2026-10-11T12:00:00.000Z",
            lastSyncedAt: null,
            failureCount: 0,
            errorCode: null,
            errorCategory: null,
            status: null,
            health: baseHealth,
          },
        }}
      />,
    );
    expect(screen.getByText("Mail")).toBeInTheDocument();
    expect(screen.queryByText("Calendar")).not.toBeInTheDocument();
    expect(screen.getByText("No successful sync recorded yet.")).toBeInTheDocument();
    expect(screen.queryByText(/Last successful sync:/)).not.toBeInTheDocument();
  });
  it("keeps an enabled unobserved sibling visible using account health", () => {
    const { rerender } = render(
      <ConnectionCapabilityHealth
        enabled={{ calendar: true, mail: true }}
        fallback={{ health: { ...baseHealth, state: "syncing" }, lastSyncedAt: null }}
        capabilities={{
          calendar: {
            health: baseHealth,
            lastAttemptAt: "2026-10-12T12:00:00.000Z",
            lastSyncedAt: "2026-10-12T12:00:00.000Z",
            failureCount: 0,
            errorCode: null,
            errorCategory: null,
            status: null,
          },
        }}
      />,
    );
    expect(screen.getByText("Mail")).toBeInTheDocument();
    expect(screen.getByText("Syncing")).toBeInTheDocument();
    expect(screen.getByText("No successful sync recorded yet.")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    rerender(
      <ConnectionCapabilityHealth
        enabled={{ calendar: false, mail: true }}
        fallback={{ health: baseHealth, lastSyncedAt: "2026-10-11T12:00:00.000Z" }}
        capabilities={{}}
      />,
    );
    expect(screen.queryByText("Calendar")).not.toBeInTheDocument();
    expect(screen.getByText(/Last successful sync/)).toBeInTheDocument();
  });
});
