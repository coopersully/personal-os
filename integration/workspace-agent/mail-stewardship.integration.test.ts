import {
  calendarAccounts,
  mailObligations,
  mailStewardshipQuestions,
  mailThreads,
} from "@personal-os/database";
import { eq } from "drizzle-orm";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("Mail stewardship through MCP", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });

  it("executes maintenance and reads its persisted run and review", async () => {
    const { client } = await f.connectAgent(["mail:read", "mail:write", "mail:execute"]);
    const response = await client.callTool({
      name: "maintain_mail",
      arguments: { scope: { type: "all_outstanding" } },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const run = (
      response.structuredContent as {
        result: { run: { id: string; settledResult: { reviewId: string } } };
      }
    ).result.run;
    expect(
      (await client.callTool({ name: "get_mail_maintenance_run", arguments: { runId: run.id } }))
        .isError,
    ).not.toBe(true);
    expect(run.settledResult.reviewId).toBeTruthy();
    const review = await client.callTool({
      name: "get_mail_review",
      arguments: { reviewId: run.settledResult.reviewId },
    });
    expect(review.isError, JSON.stringify(review)).not.toBe(true);
  });
  it("uses real populated thread, obligation, question, brief and feedback queries", async () => {
    await f.setBypass(true);
    const { client } = await f.connectAgent(["mail:read", "mail:write", "mail:execute"]);
    const [account] = await f.db
      .insert(calendarAccounts)
      .values({ userId: f.owner.id, provider: "google", label: "Stewardship", mailEnabled: true })
      .returning();
    if (!account) throw Error("Missing account");
    const [thread] = await f.db
      .insert(mailThreads)
      .values({
        userId: f.owner.id,
        accountId: account.id,
        provider: "google",
        remoteThreadId: "thread",
        subject: "A real persisted fixture",
        snippet: "Fixture snippet",
        bodyText: "Fixture body",
        from: { address: "sender@example.com", name: "Sender" },
        to: [],
        receivedAt: new Date("2026-10-11T14:00:00Z"),
      })
      .returning();
    if (!thread) throw Error("Missing thread");
    async function call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      return (result.structuredContent as { result: Record<string, unknown> }).result;
    }
    const filtered = await call("list_mail", { accountIds: [account.id], starred: true });
    expect(filtered).toEqual([]);
    expect(await call("read_mail", { id: thread.id })).toMatchObject({
      id: thread.id,
      subject: thread.subject,
    });
    await call("snooze_mail", { id: thread.id, until: "2026-10-12T15:00:00Z" });
    expect(await call("list_mail", { accountIds: [account.id], snoozed: true })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: thread.id })]),
    );
    expect(await call("get_mail_navigation_counts", { accountIds: [account.id] })).toMatchObject({
      snoozed: 1,
      drafts: 0,
    });
    expect(
      await call("get_mail_navigation_counts", {
        accountIds: ["00000000-0000-4000-8000-000000000099"],
      }),
    ).toMatchObject({ all: 0, unread: 0, starred: 0, snoozed: 0, sent: 0 });
    const other = await f.connectAgent(["mail:read"], { ownerId: f.otherOwner.id });
    const isolated = await other.client.callTool({
      name: "get_mail_navigation_counts",
      arguments: { accountIds: [account.id] },
    });
    expect(isolated.isError, JSON.stringify(isolated)).not.toBe(true);
    expect(isolated.structuredContent).toMatchObject({
      result: { all: 0, unread: 0, starred: 0, snoozed: 0, sent: 0, drafts: 0 },
    });
    const denied = await f.connectAgent(["tasks:read"]);
    expect((await denied.client.listTools()).tools.map((tool) => tool.name)).not.toContain(
      "get_mail_navigation_counts",
    );
    await expect(denied.api.getMailNavigationCounts([account.id])).rejects.toMatchObject({
      status: 403,
    });
    const revision = thread.updatedAt.toISOString();
    expect(
      await call("create_mail_attention_item", {
        threadId: thread.id,
        title: "Reply needed",
        summary: "The source thread requests a reply",
      }),
    ).toMatchObject({ relatedEntityId: thread.id });
    const obligation = await call("create_mail_obligation", {
      threadId: thread.id,
      kind: "reply",
      owner: { kind: "user" },
      rationale: "Sender requested a response",
      sourceThreadRevision: revision,
    });
    expect(obligation).toMatchObject({ threadId: thread.id, kind: "reply", state: "open" });
    await call("update_mail_obligation", {
      obligationId: obligation.id,
      expectedVersion: 1,
      state: "waiting",
    });
    expect(
      await f.db.query.mailObligations.findFirst({
        where: eq(mailObligations.id, String(obligation.id)),
      }),
    ).toMatchObject({ version: 2, state: "waiting" });
    await call("set_mail_disposition", {
      threadId: thread.id,
      disposition: "waiting",
      expectedThreadUpdatedAt: revision,
      rationale: "Waiting on the requested facts",
    });
    const stewardship = await call("get_mail_thread_stewardship", { threadId: thread.id });
    expect(JSON.stringify(stewardship)).toContain("waiting");
    const brief = await call("preview_mail_response_brief", {
      threadId: thread.id,
      expectedThreadUpdatedAt: revision,
      purpose: "Reply once facts arrive",
    });
    expect(brief).toMatchObject({ transmittable: false, sourceThreadRevision: revision });
    const [question] = await f.db
      .insert(mailStewardshipQuestions)
      .values({
        userId: f.owner.id,
        threadId: thread.id,
        accountId: account.id,
        fingerprint: "a".repeat(64),
        kind: "needs_disposition",
        reason: "Clarify disposition",
        evidence: [],
      })
      .returning();
    if (!question) throw Error("Missing question");
    expect(await call("get_mail_question", { questionId: question.id })).toMatchObject({
      status: "open",
    });
    expect(
      await call("answer_mail_question", {
        questionId: question.id,
        expectedVersion: 1,
        answer: "Wait for response",
        generalize: false,
      }),
    ).toMatchObject({ status: "answered", version: 2 });
    await call("create_mail_stewardship_feedback", {
      targetType: "obligation",
      targetId: obligation.id,
      kind: "correct",
      comment: "Matches thread evidence",
    });
    const foreign = await f.connectAgent(["mail:read"], { ownerId: f.otherOwner.id });
    expect(
      (
        await foreign.client.callTool({
          name: "get_mail_thread_stewardship",
          arguments: { threadId: thread.id },
        })
      ).isError,
    ).toBe(true);
  });
  it("previews and activates an exact saved rule with explicit execution authority", async () => {
    const { client } = await f.connectAgent(["mail:read", "mail:write", "mail:execute"]);
    async function call(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      return (result.structuredContent as { result: Record<string, unknown> }).result;
    }
    const [account] = await f.db
      .insert(calendarAccounts)
      .values({ userId: f.owner.id, provider: "google", label: "Rule source", mailEnabled: true })
      .returning();
    if (!account) throw Error("Missing account");
    const profile = await call("save_domain_profile", {
      domain: "mail",
      status: "active",
      objective: "Maintain inbox",
      summary: "Fixture source meaning",
      instructions: [],
      categories: [],
      preferences: {},
      sourceContexts: [
        { sourceId: account.id, sourceLabel: account.label, purpose: "Personal mail", notes: null },
      ],
    });
    const input = {
      name: "Read known sender",
      description: "Mark already-understood fixture mail read",
      profileId: profile.id,
      sourceIds: [account.id],
      condition: { field: "sender", operator: "ends_with", value: "@example.com" },
      actions: [{ type: "mark_read", afterDays: 0, mailboxId: null }],
      enabled: false,
      policy: "preview",
    };
    await call("preview_mail_rule", input);
    const rule = await call("create_mail_rule", input);
    const preview = await call("review_mail_rule", { id: rule.id });
    const activation = {
      ruleId: rule.id,
      expectedVersion: rule.version,
      expectedPreviewedAt: preview.previewedAt,
      expectedPreviewFingerprint: preview.fingerprint,
      expectedCandidateIds: (preview.candidates as { id: string }[]).map((v) => v.id),
    };
    await f.setBypass(false);
    expect(
      (await client.callTool({ name: "activate_mail_rule", arguments: activation })).isError,
    ).toBe(true);
    await f.setBypass(true);
    const activated = await call("activate_mail_rule", activation);
    expect(activated).toMatchObject({ rule: { enabled: true, policy: "approved_rule" } });
    expect(
      (await client.callTool({ name: "activate_mail_rule", arguments: activation })).isError,
    ).toBe(true);
    const paused = await call("update_mail_rule", {
      id: rule.id,
      expectedVersion: (activated.rule as { version: number }).version,
      enabled: false,
      policy: "preview",
    });
    expect(paused).toMatchObject({ enabled: false, policy: "preview" });
  });
});
