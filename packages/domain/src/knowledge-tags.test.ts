import {
  knowledgeTagMaxLength,
  knowledgeTagMergeInputSchema,
  knowledgeTagsInputSchema,
  normalizeKnowledgeTag,
} from "./knowledge-tags.js";

describe("knowledge tags", () => {
  it("normalizes_mechanically", () => {
    expect(normalizeKnowledgeTag("Family Members")).toBe("family-members");
    expect(normalizeKnowledgeTag("  work__notes ")).toBe("work-notes");
    expect(normalizeKnowledgeTag("Café!")).toBe("café");
    // A decomposed é composes to the same NFC tag.
    expect(normalizeKnowledgeTag("Café")).toBe("café");
    expect(normalizeKnowledgeTag("a".repeat(41))).toBe("a".repeat(knowledgeTagMaxLength));
    expect(normalizeKnowledgeTag("a".repeat(41))).toHaveLength(40);
    expect(normalizeKnowledgeTag("money - planning")).toBe("money-planning");
    expect(normalizeKnowledgeTag(`${"a".repeat(39)} b`)).toBe("a".repeat(39));
  });

  it("rejects_empty_normalized_tag", () => {
    const empty = knowledgeTagsInputSchema.safeParse(["!!!"]);
    expect(empty.success).toBe(false);
    expect(empty.error?.issues.map((issue) => issue.message).join(" ")).toContain("!!!");
    expect(normalizeKnowledgeTag("  ")).toBeNull();
    expect(knowledgeTagsInputSchema.safeParse([]).success).toBe(false);
    expect(
      knowledgeTagsInputSchema.safeParse(Array.from({ length: 9 }, (_, i) => `tag-${i}`)).success,
    ).toBe(false);
  });

  it("dedupes tags after normalization", () => {
    expect(knowledgeTagsInputSchema.parse(["Money", "money", " MONEY ", "Partner"])).toEqual([
      "money",
      "partner",
    ]);
  });

  it("normalizes merge names", () => {
    const mutationKey = "6f1c3c55-2d3f-4d58-9d5c-1fd8e0d7b4c1";
    expect(
      knowledgeTagMergeInputSchema.parse({ from: "Money", into: "Finances!", mutationKey }),
    ).toEqual({ from: "money", into: "finances", mutationKey });
    expect(
      knowledgeTagMergeInputSchema.safeParse({ from: "?", into: "finances", mutationKey }).success,
    ).toBe(false);
  });
});
