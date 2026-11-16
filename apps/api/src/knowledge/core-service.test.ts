import {
  type KnowledgeCore,
  type KnowledgeCoreEntry,
  knowledgeCoreMaxBytes,
  knowledgeCoreMaxRecords,
  knowledgeCoreSchema,
} from "@personal-os/domain";
import { packKnowledgeCore } from "./core-service.js";

const counts: KnowledgeCore["counts"] = { active: 0, conflicts: 0, archived: 0 };
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function full(n: number, text: string): KnowledgeCoreEntry {
  return {
    id: id(n),
    text,
    tags: ["fixture"],
    origin: "stated",
    ownerHeld: false,
    updatedAt: "2026-11-15T12:00:00.000Z",
  };
}

describe("packing the session-start memory core", () => {
  it("fits a smaller entry after skipping one that does not fit", () => {
    const memory = packKnowledgeCore([], [full(1, "x".repeat(4000)), full(2, "small")], counts);
    expect(memory.records.map((entry) => entry.id)).toEqual([id(2)]);
    expect(memory.truncated).toEqual({ records: true, tags: false });
    expect(bytes(memory)).toBeLessThanOrEqual(knowledgeCoreMaxBytes);
    knowledgeCoreSchema.parse(memory);
  });

  it("stops at the record cap even when small records would still fit", () => {
    const entries = Array.from({ length: 31 }, (_, n) => ({ id: id(n), label: "a" }));
    const memory = packKnowledgeCore([], entries, counts);
    expect(memory.records).toHaveLength(knowledgeCoreMaxRecords);
    expect(memory.records.map((entry) => entry.id)).toEqual(
      entries.slice(0, knowledgeCoreMaxRecords).map((entry) => entry.id),
    );
    expect(memory.truncated.records).toBe(true);
    expect(bytes(memory)).toBeLessThan(knowledgeCoreMaxBytes);
    // Exactly at the cap is not truncation.
    expect(packKnowledgeCore([], entries.slice(0, 30), counts).truncated.records).toBe(false);
  });

  it("lists a label entry when only a little budget remains", () => {
    const tags = Array.from({ length: 30 }, (_, n) => ({
      name: `tag-${String(n).padStart(2, "0")}`,
      count: 1,
    }));
    // Size a filler so about 120 bytes remain after it.
    const base = bytes(packKnowledgeCore(tags, [full(1, "")], counts));
    const filler = full(1, "f".repeat(knowledgeCoreMaxBytes - base - 120));
    const tooBig = full(2, "b".repeat(200));
    const label = { id: id(3), label: "Short label" };
    const memory = packKnowledgeCore(tags, [filler, tooBig, label], counts);
    expect(memory.tagIndex).toHaveLength(30);
    expect(memory.records.map((entry) => entry.id)).toEqual([id(1), id(3)]);
    expect(memory.records[1]).toEqual(label);
    expect(memory.truncated.records).toBe(true);
    expect(bytes(memory)).toBeLessThanOrEqual(knowledgeCoreMaxBytes);
  });
});
