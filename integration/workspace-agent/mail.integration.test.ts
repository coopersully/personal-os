import { calendarAccounts } from "@personal-os/database";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("Mail MCP execution", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("creates, edits, reads and deletes a persisted draft", async () => {
    const [account] = await f.db
      .insert(calendarAccounts)
      .values({ userId: f.owner.id, provider: "google", label: "Mail fixture", mailEnabled: true })
      .returning();
    const { client } = await f.connectAgent(["mail:read", "mail:write"]);
    async function call(name: string, args: Record<string, unknown> = {}) {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      return (response.structuredContent as { result: unknown }).result;
    }
    const input = {
      accountId: account!.id,
      subject: "Draft",
      body: "Test",
      to: [{ address: "recipient@example.com", name: "Recipient" }],
    };
    const draft = (await call("create_mail_draft", input)) as { id: string; updatedAt: string };
    await call("update_mail_draft", {
      ...input,
      draftId: draft.id,
      expectedUpdatedAt: draft.updatedAt,
      subject: "Edited",
    });
    expect(await call("list_mail_drafts")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: draft.id, subject: "Edited" })]),
    );
    await call("delete_mail_draft", { draftId: draft.id });
    expect(await call("list_mail_drafts")).toEqual([]);
  });
});
