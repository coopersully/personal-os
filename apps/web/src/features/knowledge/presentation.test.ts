import type { KnowledgeLifecycleInput, KnowledgeRecord } from "@personal-os/domain";
import { knowledgePurposeSchema } from "@personal-os/domain";
import { describe, expect, it, vi } from "vitest";
import { lifecycleCopy } from "./actions";
import {
  isTrashRoot,
  memoryAgo,
  memoryAuthor,
  memoryContent,
  memoryFreshness,
  memoryStatus,
  memoryTrashDaysLeft,
  memoryUses,
  memoryWorkspace,
} from "./presentation";

vi.mock("@/api", () => ({ api: {} }));

const id = "22222222-2222-4222-8222-222222222222";
const at = Date.parse("2026-11-15T12:00:00.000Z");
const ago = (seconds: number) => new Date(at - seconds * 1000).toISOString();

describe("memory presentation", () => {
  it("describes how long ago something happened", () => {
    expect(memoryAgo(ago(10), at)).toBe("just now");
    expect(memoryAgo(ago(5 * 60), at)).toBe("5 minutes ago");
    expect(memoryAgo(ago(2 * 60 * 60), at)).toBe("2 hours ago");
    expect(memoryAgo(ago(3 * 24 * 60 * 60), at)).toBe("3 days ago");
    expect(memoryAgo(ago(60 * 24 * 60 * 60), at)).toBe("2 months ago");
    expect(memoryAgo(ago(400 * 24 * 60 * 60), at)).toBe("1 year ago");
    expect(memoryAgo(new Date(at + 1000).toISOString(), at)).toBe("just now");
  });

  it("says when a memory was added and later confirmed, never that it was updated", () => {
    const createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const confirmed = new Date().toISOString();
    expect(memoryFreshness({ createdAt, lastConfirmedAt: null })).toBe("Added 10 days ago");
    expect(memoryFreshness({ createdAt, lastConfirmedAt: confirmed })).toBe(
      "Added 10 days ago · Confirmed just now",
    );
    // A confirmation older than the record adds nothing.
    expect(memoryFreshness({ createdAt: confirmed, lastConfirmedAt: createdAt })).toBe(
      "Added just now",
    );
  });

  it("labels status, author, workspace and uses without a confidence score", () => {
    expect(memoryStatus({ status: "active" })).toBeNull();
    expect(memoryStatus({ status: "proposed" })).toBe("Agent proposal");
    expect(memoryStatus({ status: "expired" })).toBe("Expired");
    expect(memoryAuthor({ author: { actorId: id, actorType: "user" } })).toBe("You");
    expect(memoryAuthor({ author: { actorId: id, actorType: "agent" } })).toBe(`Agent ${id}`);
    expect(memoryWorkspace({ scope: { workspace: "finances" } })).toBe("Finances");
    expect(memoryWorkspace({ scope: { workspace: null } })).toBe("All workspaces");
    expect(memoryUses({ purposes: [] })).toBe("All uses");
    expect(memoryUses({ purposes: [...knowledgePurposeSchema.options] })).toBe("All uses");
    expect(memoryUses({ purposes: ["planning", "review"] })).toBe("Planning, Review");
  });

  it("finds a Trash group's root and the days it has left", () => {
    const trashedAt = ago(2 * 24 * 60 * 60);
    expect(isTrashRoot({ id, trashGroupId: id, trashedAt })).toBe(true);
    expect(isTrashRoot({ id, trashGroupId: "other", trashedAt })).toBe(false);
    expect(isTrashRoot({ id, trashGroupId: id, trashedAt: null })).toBe(false);
    expect(memoryTrashDaysLeft(trashedAt, at)).toBe(28);
    expect(memoryTrashDaysLeft(ago(40 * 24 * 60 * 60), at)).toBe(0);
  });

  it("reads a generated inference as its typed claim, and anything else as written", () => {
    const claim: KnowledgeRecord["content"] = {
      kind: "fact",
      value: { subject: "owner", predicate: "city", value: { type: "string", value: "Austin" } },
    };
    const inference = (proposition: string): KnowledgeRecord["content"] => ({
      kind: "inference",
      value: {
        subject: "owner",
        proposition,
        uncertainty: "Unsure",
        evidenceIds: [],
        reviewCondition: "Ask",
      },
    });
    const base = {
      origin: "inferred",
      scope: { workspace: null },
      claimKey: '[null,"fact","owner","city"]',
    } as const;
    const generated = { ...base, content: inference(JSON.stringify(claim)) } as KnowledgeRecord;
    expect(memoryContent(generated)).toEqual(claim);
    const prose = { ...base, content: inference("Probably likes mornings") } as KnowledgeRecord;
    expect(memoryContent(prose)).toEqual(prose.content);
    const mismatched = { ...generated, claimKey: '[null,"fact","owner","other"]' };
    expect(memoryContent(mismatched as KnowledgeRecord)).toEqual(generated.content);
    const stated = { ...generated, origin: "stated" } as KnowledgeRecord;
    expect(memoryContent(stated)).toEqual(generated.content);
  });

  it("gives every lifecycle action its own pending, outcome and conflict copy", () => {
    const identity = { recordId: id, expectedRevision: 1, mutationKey: id };
    const inputs: KnowledgeLifecycleInput[] = [
      { ...identity, action: "confirm" },
      { ...identity, action: "dispute" },
      { ...identity, action: "archive" },
      { ...identity, action: "unarchive" },
      { ...identity, action: "supersede", replacementId: id },
      { ...identity, action: "restrict", workspace: "mail" },
      { ...identity, action: "widen", workspace: null },
      { ...identity, action: "raise_sensitivity" },
      { ...identity, action: "set_sensitivity", sensitivity: "standard" },
      { ...identity, action: "set_access", agentAccess: "allowed" },
      { ...identity, action: "resolve_conflict", keep: "proposed" },
      { ...identity, action: "trash" },
      { ...identity, action: "restore" },
      { ...identity, action: "delete_now", expectedTrashVersion: 1 },
    ];
    const copies = inputs.map(lifecycleCopy);
    for (const copy of copies) {
      expect(copy.pending).toMatch(/…$/);
      expect(copy.success).toMatch(/\.$/);
      expect(copy.conflict).toMatch(/\.$/);
    }
    expect(copies.map((copy) => copy.success)).toEqual([
      "Memory confirmed.",
      "Memory disputed.",
      "Memory archived.",
      "Memory unarchived.",
      "Memory superseded.",
      "Workspace updated.",
      "Workspace updated.",
      "Memory marked sensitive.",
      "Memory marked standard.",
      "Agents can read this memory.",
      "Took the agent's version.",
      "Memory moved to Trash.",
      "Memory restored.",
      "Memory deleted.",
    ]);
  });
});
