import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import appConfig from "../../../app.json";
import { redirectLink } from "./intent";
import { handoffPaths, isHandoffLink, isWebLink, linkRoutes, nativeLink } from "./parse";
import { offerLink, pendingLink, subscribeToLinks, takeLink } from "./pending";

const origin = "https://nohmi.example";
const id = "0b9c2f4e-6a51-4c0e-9a3d-2f1f6f0d8e11";
afterEach(() => {
  takeLink();
});

describe("nativeLink", () => {
  it.each([
    [`/tasks?task=${id}`, { pathname: "/task-editor", params: { id, kind: "task" } }],
    [`/reminders?reminder=${id}`, { pathname: "/task-editor", params: { id, kind: "reminder" } }],
    [
      `/finances/transactions?transactionId=${id}`,
      { pathname: "/finance-transaction", params: { id } },
    ],
    [
      `/calendar?follow=0&date=2026-11-17&event=${id}`,
      { pathname: "/calendar-event", params: { id } },
    ],
    [`/tasks/?task=${id}#top`, { pathname: "/task-editor", params: { id, kind: "task" } }],
  ])("opens %s on its native screen", (path, href) => {
    expect(nativeLink(`${origin}${path}`, origin)).toEqual({ kind: "screen", href });
  });
  it("keeps ids that merely contain dots", () => {
    expect(nativeLink(`${origin}/calendar?event=series.2026-11-17`, origin)).toEqual({
      kind: "screen",
      href: { pathname: "/calendar-event", params: { id: "series.2026-11-17" } },
    });
  });
  it("opens a mail conversation link in the reader", () => {
    expect(nativeLink(`${origin}/mail?view=all&thread=${id}`, origin)).toEqual({
      kind: "conversation",
      id,
    });
  });
  it.each([
    ["another origin", `https://nohmi.example.evil.test/tasks?task=${id}`],
    ["plain http on the same host", `http://nohmi.example/tasks?task=${id}`],
    ["credentials in the URL", `https://user:secret@nohmi.example/tasks?task=${id}`],
    ["a workspace page without a record", `${origin}/tasks`],
    ["an unknown path", `${origin}/settings?section=mail&reviewRule=${id}`],
    ["a path under a supported one", `${origin}/tasks/archive?task=${id}`],
    ["the wrong record parameter", `${origin}/tasks?reminder=${id}`],
    ["an empty id", `${origin}/tasks?task=`],
    ["a repeated id", `${origin}/tasks?task=${id}&task=other`],
    ["an id that is not a record id", `${origin}/tasks?task=..%2F..%2Fsettings`],
    ["a parent-directory id", `${origin}/mail?thread=..`],
    ["a current-directory id", `${origin}/calendar?event=.`],
    ["an id of only dots", `${origin}/reminders?reminder=...`],
    ["an overlong id", `${origin}/tasks?task=${"a".repeat(201)}`],
    ["text that is not a URL", "https://"],
  ])("rejects %s", (_case, url) => {
    expect(nativeLink(url, origin)).toBeNull();
  });
  it("tells web links from custom-scheme paths", () => {
    expect(isWebLink("HTTPS://nohmi.example/tasks")).toBe(true);
    expect(isWebLink("personal-os:///?skyPreview=morning")).toBe(false);
    expect(isWebLink("/tasks")).toBe(false);
  });
});

describe("the hosted association file", () => {
  const file = JSON.parse(
    readFileSync(
      new URL("../../../../web/public/.well-known/apple-app-site-association", import.meta.url),
      "utf8",
    ),
  ) as {
    applinks: {
      details: { appIDs: string[]; components: { "/": string; "?"?: Record<string, string> }[] }[];
    };
  };
  const [detail] = file.applinks.details;
  it("names this app", () => {
    const { appleTeamId, bundleIdentifier } = appConfig.expo.ios;
    expect(file.applinks.details).toHaveLength(1);
    expect(detail?.appIDs).toEqual([`${appleTeamId}.${bundleIdentifier}`]);
  });
  it("claims exactly the record links, each with a required id, and the return paths", () => {
    expect(detail?.components.map((component) => [component["/"], component["?"]])).toEqual([
      ...linkRoutes.map((route) => [route.path, { [route.param]: "?*" }]),
      ...handoffPaths.map((path) => [path, undefined]),
    ]);
    for (const component of detail?.components ?? []) {
      const [param] = Object.keys(component["?"] ?? {});
      const url = `${origin}${component["/"]}${param ? `?${param}=${id}` : ""}`;
      expect(nativeLink(url, origin) !== null || isHandoffLink(url, origin)).toBe(true);
    }
  });
});

describe("redirectLink", () => {
  it("leaves custom-scheme paths to the router and queues nothing", () => {
    expect(redirectLink("personal-os:///?skyPreview=morning", true, origin)).toBe(
      "personal-os:///?skyPreview=morning",
    );
    expect(redirectLink("/tasks", false, origin)).toBe("/tasks");
    expect(pendingLink()).toBeNull();
  });
  it("queues a supported web link and starts on Today instead of routing its web path", () => {
    expect(redirectLink(`${origin}/tasks?task=${id}`, true, origin)).toBe("/");
    expect(takeLink()).toEqual({
      kind: "screen",
      href: { pathname: "/task-editor", params: { id, kind: "task" } },
    });
  });
  it("stays on the current screen for a link that arrives while the app is open", () => {
    expect(redirectLink(`${origin}/mail?thread=${id}`, false, origin)).toBeNull();
    expect(takeLink()).toEqual({ kind: "conversation", id });
  });
  it("drops a bank sign-in return link without queuing or routing its parameters", () => {
    const back = `${origin}/plaid/return/?oauth_state_id=secret-state`;
    expect(isHandoffLink(back, origin)).toBe(true);
    expect(nativeLink(back, origin)).toBeNull();
    expect(redirectLink(back, false, origin)).toBeNull();
    expect(redirectLink(back, true, origin)).toBe("/");
    expect(pendingLink()).toBeNull();
    expect(isHandoffLink("https://elsewhere.test/plaid/return", origin)).toBe(false);
    expect(isHandoffLink(`${origin}/plaid/return/extra`, origin)).toBe(false);
    expect(isHandoffLink("https://", origin)).toBe(false);
  });
  it("queues an unsupported web link as unsupported and never routes it", () => {
    expect(redirectLink(`${origin}/settings?section=security`, false, origin)).toBeNull();
    expect(takeLink()).toEqual({ kind: "unsupported" });
    expect(redirectLink("https://elsewhere.test/tasks?task=1", true, origin)).toBe("/");
    expect(takeLink()).toEqual({ kind: "unsupported" });
  });
});

describe("the pending link", () => {
  it("keeps only the newest link, hands it over once and tells subscribers", () => {
    let changes = 0;
    const stop = subscribeToLinks(() => {
      changes += 1;
    });
    offerLink({ kind: "conversation", id: "first" });
    offerLink({ kind: "conversation", id: "second" });
    expect(pendingLink()).toEqual({ kind: "conversation", id: "second" });
    expect(takeLink()).toEqual({ kind: "conversation", id: "second" });
    expect(takeLink()).toBeNull();
    expect(changes).toBe(3);
    stop();
    offerLink({ kind: "unsupported" });
    expect(changes).toBe(3);
  });
});
