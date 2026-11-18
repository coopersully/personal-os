import { type KnowledgeRecord, knowledgeClaimKey } from "@personal-os/domain";
import { expect, it } from "vitest";
import {
  contentDraft,
  fieldDraft,
  linkedMemoryIds,
  memoryClaimFields,
  memoryContent,
  memoryFreshness,
  memoryLabels,
  memoryStatus,
} from "./presentation";

const id = "7d175d08-e235-49e9-900a-8b103bb68f9c";
const other = "1e8a2c55-7a07-4c63-9d0e-6f1d6d2d0a01";
const claim: KnowledgeRecord["content"] = {
  kind: "fact",
  value: { subject: "owner", predicate: "home", value: { type: "string", value: "Lisbon" } },
};
const record = (overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord => ({
  id,
  origin: "stated",
  revision: 1,
  status: "active",
  ownerHeld: true,
  agentAccess: "allowed",
  core: false,
  tags: [],
  lastConfirmedAt: null,
  schemaVersion: 1,
  claimKey: null,
  content: claim,
  acceptance: null,
  author: { actorId: id, actorType: "user" },
  requiredReadScopes: [],
  validFrom: null,
  validUntil: null,
  reviewAt: null,
  scope: { workspace: null },
  sensitivity: "standard",
  purposes: [],
  confidence: 1,
  sources: [],
  relatedRecordIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  conflictRecordIds: [],
  evidenceAvailable: true,
  supersededBy: null,
  trashedAt: null,
  trashGroupId: null,
  ...overrides,
});
const inference = (proposition: string): KnowledgeRecord["content"] => ({
  kind: "inference",
  value: {
    subject: "owner",
    proposition,
    uncertainty: "Unconfirmed",
    evidenceIds: [other],
    reviewCondition: "Ask",
  },
});

it("an_agent_inference_reads_as_the_claim_it_carries", () => {
  const generated = record({
    origin: "inferred",
    content: inference(JSON.stringify(claim)),
    claimKey: knowledgeClaimKey(null, claim),
  });
  expect(memoryContent(generated)).toEqual(claim);
  // A key that does not match, or text that is not a claim, keeps the inference itself.
  const mismatched = { ...generated, claimKey: "other" };
  expect(memoryContent(mismatched)).toBe(mismatched.content);
  const prose = { ...generated, content: inference("Prefers mornings") };
  expect(memoryContent(prose)).toBe(prose.content);
  expect(memoryContent(record())).toBe(claim);
});

it("labels_origin_sensitivity_and_status_without_scores", () => {
  expect(memoryLabels(record())).toEqual(["Stated"]);
  expect(memoryLabels(record({ origin: "inferred", sensitivity: "sensitive" }))).toEqual([
    "Inferred",
    "Sensitive",
  ]);
  expect(memoryStatus(record())).toBeUndefined();
  expect(memoryStatus(record({ status: "proposed" }))).toBe("Agent’s proposal");
  expect(memoryStatus(record({ status: "superseded" }))).toBe("Replaced");
  expect(memoryStatus(record({ status: "expired" }))).toBe("Expired");
  expect(memoryStatus(record({ trashedAt: "2026-01-02T00:00:00.000Z" }))).toBe("In Trash");
});

it("describes_when_a_memory_was_added_and_confirmed_never_updated", () => {
  const at = (iso: string) => Date.parse(iso);
  const saved = record({ createdAt: "2026-01-01T12:00:00.000Z" });
  expect(memoryFreshness(saved, at("2026-01-01T13:00:00.000Z"))).toBe("Added today");
  expect(memoryFreshness(saved, at("2026-01-02T13:00:00.000Z"))).toBe("Added yesterday");
  expect(memoryFreshness(saved, at("2026-01-05T13:00:00.000Z"))).toBe("Added 4 days ago");
  expect(memoryFreshness(saved, at("2026-02-05T13:00:00.000Z"))).toBe("Added a month ago");
  expect(memoryFreshness(saved, at("2026-05-05T13:00:00.000Z"))).toBe("Added 4 months ago");
  expect(memoryFreshness(saved, at("2027-01-15T13:00:00.000Z"))).toBe("Added a year ago");
  expect(memoryFreshness(saved, at("2029-02-01T13:00:00.000Z"))).toBe("Added 3 years ago");
  // A later confirmation is named as such; createdAt is never presented as an update.
  const confirmed = { ...saved, lastConfirmedAt: "2026-03-01T12:00:00.000Z" };
  expect(memoryFreshness(confirmed, at("2026-03-01T13:00:00.000Z"))).toBe(
    "Added a month ago · Confirmed today",
  );
  const sameTime = { ...saved, lastConfirmedAt: saved.createdAt };
  expect(memoryFreshness(sameTime, at("2026-01-01T13:00:00.000Z"))).toBe("Added today");
  expect(memoryFreshness(confirmed, at("2026-03-01T13:00:00.000Z"))).not.toMatch(/Updated/);
});

it("lists_linked_memories_once_and_never_itself", () => {
  const relationship = record({
    content: {
      kind: "relationship",
      value: {
        subjectId: id,
        objectId: other.toUpperCase(),
        relationship: "partner",
        direction: "directed",
      },
    },
    relatedRecordIds: [other],
  });
  expect(linkedMemoryIds(relationship)).toEqual([other]);
});

it("drafts_and_reads_typed_values", () => {
  expect(fieldDraft()).toEqual({ subject: "owner", valueType: "string" });
  const count = contentDraft("fact", {
    subject: "owner",
    predicate: "kids",
    valueType: "integer",
    value: "2",
  });
  expect(count.success && count.data).toMatchObject({
    value: { value: { type: "integer", value: 2 } },
  });
  const flag = contentDraft("preference", {
    subject: "owner",
    key: "dark",
    valueType: "boolean",
    value: "false",
  });
  expect(flag.success && flag.data).toMatchObject({ value: { value: { value: false } } });
  const decision: KnowledgeRecord["content"] = {
    kind: "decision",
    value: { subject: "Car", option: "Sell", reason: "Unused", evidenceIds: [other] },
  };
  const redrafted = contentDraft("decision", fieldDraft(decision), decision);
  expect(redrafted.success && redrafted.data).toEqual(decision);
  expect(memoryClaimFields(decision)).toContainEqual(["Evidence IDs", other]);
  const fresh = contentDraft("decision", fieldDraft(decision));
  expect(fresh.success && fresh.data.kind === "decision" && fresh.data.value.evidenceIds).toEqual(
    [],
  );
});
