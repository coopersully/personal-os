// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ConnectedAccountHealth } from "@personal-os/domain";
import { render, screen } from "@testing-library/react";
import {
  ConnectionHealthBadge,
  ConnectionHealthDescription,
  ConnectionRecoveryAlert,
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
});
