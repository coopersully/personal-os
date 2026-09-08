import { describe, expect, it } from "vitest";
import { createIloAppLinks, resolveAppBaseUrl } from "./app-links.js";

describe("Nomi application links", () => {
  it("requires an explicit secure production origin", () => {
    expect(() => resolveAppBaseUrl({}, { production: true })).toThrow(/APP_BASE_URL/);
    expect(() =>
      resolveAppBaseUrl({ APP_BASE_URL: "http://app.example.com" }, { production: true }),
    ).toThrow(/https/);
    expect(() =>
      resolveAppBaseUrl({ APP_BASE_URL: "https://localhost" }, { production: true }),
    ).toThrow(/localhost/);
  });

  it("normalizes a valid application origin and rejects ambiguous base URLs", () => {
    expect(
      resolveAppBaseUrl({ APP_BASE_URL: "https://app.example.com/" }, { production: true }),
    ).toBe("https://app.example.com");
    expect(() =>
      resolveAppBaseUrl({ APP_BASE_URL: "https://person@app.example.com" }, { production: true }),
    ).toThrow(/credentials/);
    expect(() =>
      resolveAppBaseUrl({ APP_BASE_URL: "https://app.example.com/base" }, { production: true }),
    ).toThrow(/origin/);
    expect(() =>
      resolveAppBaseUrl({ APP_BASE_URL: "https://app.example.com?mode=1" }, { production: true }),
    ).toThrow(/query/);
    expect(() =>
      resolveAppBaseUrl({ APP_BASE_URL: "ftp://app.example.com" }, { production: false }),
    ).toThrow(/HTTP or HTTPS/);
  });

  it("maps approvals to the workspace that owns the decision", () => {
    expect(createIloAppLinks("https://app.example.com", "finances")).toEqual({
      activity: "https://app.example.com/activity",
      agentAccess: "https://app.example.com/settings?section=workspace-access",
      approvals: "https://app.example.com/finances/review",
      recovery: "https://app.example.com/settings?section=connections",
      today: "https://app.example.com/today",
    });
    expect(createIloAppLinks("https://app.example.com", "mail").approvals).toBe(
      "https://app.example.com/mail",
    );
    expect(createIloAppLinks("https://app.example.com", "calendar").approvals).toBe(
      "https://app.example.com/calendar",
    );
    expect(createIloAppLinks("https://app.example.com", "reminders").approvals).toBe(
      "https://app.example.com/tasks",
    );
    expect(createIloAppLinks("https://app.example.com", "assistant").approvals).toBe(
      "https://app.example.com/reviews",
    );
  });
});
