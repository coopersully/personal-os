import type {
  Calendar,
  FinanceGuidedSetupContext,
  MailSetupContext,
  Reminder,
} from "@personal-os/domain";
import {
  calendarAgentAccessCapability,
  calendarAgentAccessReadiness,
} from "../calendar/agent-access.js";
import {
  financeAgentAccessCapability,
  financeAgentAccessReadiness,
} from "../finances/agent-access.js";
import { mailAgentAccessCapability, mailAgentAccessReadiness } from "../mail/agent-access.js";
import {
  reminderAgentAccessCapability,
  reminderAgentAccessReadiness,
} from "../reminders/agent-access.js";
import {
  attentionReadiness,
  type DomainSetupStatus,
  hostPermissionReadiness,
  type Loadable,
  mapLoadable,
  profileReadiness,
} from "./readiness.js";

const loading = { state: "loading" } as const;
const unavailable = { state: "unavailable" } as const;
const ready = <T>(data: T): Loadable<T> => ({ data, state: "ready" });

const emptyProfile: DomainSetupStatus = {
  approvedProfileStatus: null,
  approvedProfileVersion: null,
  canRead: true,
  canWrite: true,
  domain: "mail",
  pendingDraftVersion: null,
  profileStatus: null,
  profileVersion: null,
};

describe("agent access readiness adapters", () => {
  it("keeps shared profile, attention, and host evidence states explicit", () => {
    expect(mapLoadable(ready(2), (value) => value * 2)).toEqual({ data: 4, state: "ready" });
    expect(mapLoadable(loading, (value: number) => value * 2)).toBe(loading);

    expect(profileReadiness("Mail", loading).description).toContain("loading");
    expect(profileReadiness("Mail", unavailable).description).toContain("unavailable");
    expect(profileReadiness("Mail", ready(emptyProfile)).description).toContain("guided interview");
    expect(
      profileReadiness(
        "Mail",
        ready({ ...emptyProfile, profileStatus: "draft", profileVersion: 2 }),
      ).description,
    ).toContain("waiting for review");
    expect(
      profileReadiness(
        "Mail",
        ready({ ...emptyProfile, profileStatus: "active", profileVersion: 2 }),
      ).description,
    ).toContain("Profile v2");
    expect(
      profileReadiness(
        "Mail",
        ready({
          ...emptyProfile,
          approvedProfileStatus: "active",
          approvedProfileVersion: 2,
          pendingDraftVersion: 3,
        }),
      ).description,
    ).toContain("draft v3");
    expect(
      profileReadiness(
        "Mail",
        ready({
          ...emptyProfile,
          approvedProfileStatus: "active",
          approvedProfileVersion: 2,
        }),
      ).description,
    ).toBe("Approved guidance v2 is active.");

    expect(attentionReadiness("Mail", loading).description).toContain("loading");
    expect(attentionReadiness("Mail", unavailable).description).toContain("unavailable");
    expect(attentionReadiness("Mail", ready([])).description).toContain("No open");
    expect(attentionReadiness("Mail", ready([{ id: "one" } as never])).description).toContain(
      "1 open",
    );
    expect(
      attentionReadiness(
        "Mail",
        ready(Array.from({ length: 100 }, (_, index) => ({ id: `${index}` }) as never)),
      ).description,
    ).toContain("100+");

    const hostInput = {
      label: "Mail",
      readScope: "mail:read" as const,
      writeCapability: "manage Mail",
      writeScope: "mail:write" as const,
    };
    expect(hostPermissionReadiness({ ...hostInput, hosts: loading }).description).toContain(
      "loading",
    );
    expect(hostPermissionReadiness({ ...hostInput, hosts: unavailable }).description).toContain(
      "cannot claim",
    );
    expect(hostPermissionReadiness({ ...hostInput, hosts: ready([]) }).description).toContain(
      "No connected host",
    );
    expect(
      hostPermissionReadiness({
        ...hostInput,
        hosts: ready([{ name: "Reader", scopes: ["mail:read"] }]),
      }).description,
    ).toContain("none has Mail write");
    expect(
      hostPermissionReadiness({
        ...hostInput,
        hosts: ready([
          { name: "Reader one", scopes: ["mail:read"] },
          { name: "Reader two", scopes: ["mail:read"] },
        ]),
      }).description,
    ).toBe("2 connected hosts can read Mail; none has Mail write permission.");
    expect(
      hostPermissionReadiness({
        ...hostInput,
        hosts: ready([{ name: "Writer", scopes: ["mail:read", "mail:write"] }]),
      }).description,
    ).toBe("1 connected host can read Mail; 1 can manage Mail.");
  });

  it("covers Mail source, rule, automation, and support variants", () => {
    const base = {
      attention: ready([]),
      hosts: ready([]),
      profile: ready(emptyProfile),
      rules: ready([]),
      setup: loading,
    };
    expect(mailAgentAccessReadiness(base)[0]?.description).toContain("loading");
    expect(mailAgentAccessReadiness({ ...base, rules: unavailable })[1]?.description).toContain(
      "unavailable",
    );
    expect(mailAgentAccessReadiness({ ...base, setup: unavailable })[2]?.description).toContain(
      "unavailable",
    );
    expect(
      mailAgentAccessReadiness({
        ...base,
        setup: ready({ accounts: [], automation: {} } as unknown as MailSetupContext),
      })[3]?.description,
    ).toContain("cannot claim verified commitment evidence");

    const emptySetup = {
      accounts: [],
      automation: {
        executionLimitPerRun: 6,
        failedCount: 0,
        inProgressCount: 0,
        lastCompletedAt: null,
        oldestDueAt: null,
        pendingCount: 0,
        reconciliationCount: 0,
      },
      commitmentIntake: {
        automaticCreationEnabled: false,
        previewOnlyCount: 0,
        serverVerifiedCount: 0,
      },
    } as unknown as MailSetupContext;
    expect(mailAgentAccessReadiness({ ...base, setup: ready(emptySetup) })[0]).toMatchObject({
      complete: false,
      description: "No Mail account is connected yet.",
    });

    const activeProfile = {
      ...emptyProfile,
      profileStatus: "active",
      profileVersion: 1,
    } as DomainSetupStatus;
    const connectedSetup = {
      ...emptySetup,
      accounts: [
        { email: "one@example.com", label: "One", syncStatus: "idle" },
        { email: null, label: "Two", syncStatus: "error" },
        { email: "three@example.com", label: "Three", syncStatus: "idle" },
      ],
      automation: {
        ...emptySetup.automation,
        failedCount: 1,
        lastCompletedAt: "2026-07-28T12:00:00.000Z",
        oldestDueAt: "2026-07-28T13:00:00.000Z",
        pendingCount: 1,
      },
      commitmentIntake: {
        automaticCreationEnabled: false,
        previewOnlyCount: 2,
        serverVerifiedCount: 0,
      },
    } as MailSetupContext;
    const rows = mailAgentAccessReadiness({
      ...base,
      profile: ready(activeProfile),
      rules: ready([{ enabled: true, policy: "approved_rule" } as never]),
      setup: ready(connectedSetup),
    });
    expect(rows[0]?.description).toContain("one@example.com, Two +1 · 1 needs reconnect");
    expect(rows[1]?.description).toContain("1 active approved Mail rule");
    expect(rows[2]?.description).toContain("Oldest due:");
    expect(rows[3]).toMatchObject({
      complete: false,
      title: "Mail commitment intake",
    });
    expect(rows[3]?.description).toContain("2 preview-only calendar attachment candidates");
    expect(rows[3]?.description).toContain("Automatic Calendar creation is not enabled");

    expect(mailAgentAccessCapability("unsupported", "$ilo-setup").setupPrompt).toBeNull();
    expect(mailAgentAccessCapability("profile_and_attention", "$ilo-setup").title).toContain(
      "preferences",
    );
    expect(mailAgentAccessCapability("executable_rules", "$ilo-setup").title).toContain("rules");
  });

  it("covers Calendar, Finance, and Reminder domain-owned variants", () => {
    const shared = {
      attention: ready([]),
      hosts: ready([]),
      profile: ready(emptyProfile),
    };
    expect(
      calendarAgentAccessReadiness({ ...shared, calendars: loading })[0]?.description,
    ).toContain("loading");
    expect(
      calendarAgentAccessReadiness({ ...shared, calendars: unavailable })[2]?.description,
    ).toContain("unavailable");
    expect(calendarAgentAccessReadiness({ ...shared, calendars: ready([]) })[0]).toMatchObject({
      complete: false,
    });
    const calendarRows = calendarAgentAccessReadiness({
      ...shared,
      calendars: ready([
        {
          isSelected: true,
          isWritable: false,
          source: { syncStatus: "error" },
        } as Calendar,
      ]),
    });
    expect(calendarRows[0]?.description).toContain("1 needs reconnect");
    expect(calendarRows[2]?.description).toContain("required");
    expect(calendarAgentAccessCapability("unsupported", "$ilo-setup").setupPrompt).toBeNull();
    expect(calendarAgentAccessCapability("executable_rules", "$ilo-setup").title).toContain(
      "rules",
    );

    expect(financeAgentAccessReadiness({ ...shared, setup: loading })[0]?.description).toContain(
      "loading",
    );
    expect(
      financeAgentAccessReadiness({ ...shared, setup: unavailable })[2]?.description,
    ).toContain("unavailable");
    const financeSetup = {
      accountSources: [],
      ledgerHealth: { staleAccounts: 0 },
      reviewSummary: { count: 1 },
      suggestedWorkflows: [{ available: true }],
    } as unknown as FinanceGuidedSetupContext;
    const financeRows = financeAgentAccessReadiness({
      ...shared,
      setup: ready(financeSetup),
    });
    expect(financeRows[0]).toMatchObject({ complete: false });
    expect(financeRows[2]?.description).toContain("1 item needs");
    expect(financeAgentAccessCapability("unsupported", "$ilo-setup").setupPrompt).toBeNull();
    expect(financeAgentAccessCapability("executable_rules", "$ilo-setup").title).toContain("rules");

    expect(
      reminderAgentAccessReadiness({ ...shared, reminders: loading })[0]?.description,
    ).toContain("loading");
    expect(
      reminderAgentAccessReadiness({ ...shared, reminders: unavailable })[0]?.description,
    ).toContain("unavailable");
    expect(
      reminderAgentAccessReadiness({
        ...shared,
        reminders: ready({ items: [], nextCursor: null }),
      })[0]?.description,
    ).toContain("No open Reminders");
    expect(
      reminderAgentAccessReadiness({
        ...shared,
        reminders: ready({ items: [{ id: "one" } as Reminder], nextCursor: "next" }),
      })[0]?.description,
    ).toContain("1+ open Reminder");
    expect(reminderAgentAccessCapability("unsupported", "$ilo-setup").setupPrompt).toBeNull();
    expect(reminderAgentAccessCapability("executable_rules", "$ilo-setup").title).toContain(
      "rules",
    );
  });
});
