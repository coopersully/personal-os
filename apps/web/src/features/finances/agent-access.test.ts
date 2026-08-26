import { describe, expect, it } from "vitest";
import { financeAgentAccessCapability, financeAgentAccessReadiness } from "./agent-access.js";

const readyProfile = { data: undefined, state: "ready" } as const;
const hosts = { data: [], state: "ready" } as const;

describe("Finance agent access", () => {
  it("reports loading and unavailable Finance setup honestly", () => {
    expect(
      financeAgentAccessReadiness({
        hosts: hosts as never,
        profile: readyProfile,
        setup: { state: "loading" },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "Finance sources are loading.", title: "Accounts" }),
        expect.objectContaining({
          description: "Finance workflows are loading.",
          title: "Workflow",
        }),
      ]),
    );
    expect(
      financeAgentAccessReadiness({
        hosts: hosts as never,
        profile: readyProfile,
        setup: { state: "unavailable" },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: "Finance sources are unavailable.",
          title: "Accounts",
        }),
      ]),
    );
  });

  it("describes connected and incomplete Finance workspace setup", () => {
    const base = {
      accountSources: [],
      ledgerHealth: { staleAccounts: 0 },
      suggestedWorkflows: [],
    };
    expect(
      financeAgentAccessReadiness({
        hosts: hosts as never,
        profile: readyProfile,
        setup: { data: base as never, state: "ready" },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          complete: false,
          nextStep: "Connect a Finance account",
          title: "Accounts",
        }),
        expect.objectContaining({
          complete: false,
          nextStep: "Set up a Finance guidance or review workflow",
          title: "Workflow",
        }),
      ]),
    );
    expect(
      financeAgentAccessReadiness({
        hosts: hosts as never,
        profile: readyProfile,
        setup: {
          data: {
            ...base,
            accountSources: [{ id: "account" }],
            ledgerHealth: { staleAccounts: 2 },
            suggestedWorkflows: [{ available: true }, { available: false }],
          } as never,
          state: "ready",
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          complete: true,
          description: "1 Finance account · 2 stale",
          title: "Accounts",
        }),
        expect.objectContaining({
          complete: true,
          description: "1 guidance or review workflow ready",
          title: "Workflow",
        }),
      ]),
    );
  });

  it("keeps unsupported capability distinct from executable rules", () => {
    expect(financeAgentAccessCapability("unsupported", "ilo://finances")).toMatchObject({
      unavailable: ["Agent access is unavailable in this deployment."],
    });
    expect(financeAgentAccessCapability("executable_rules", "ilo://finances")).toMatchObject({
      title: "Finance guidance, review, and rules",
    });
    expect(financeAgentAccessCapability("profile_and_attention", "ilo://finances")).toMatchObject({
      title: "Finance guidance and signed-in review",
    });
  });
});
