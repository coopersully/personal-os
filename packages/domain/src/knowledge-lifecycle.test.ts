import type { KnowledgeRecordSnapshot } from "./knowledge.js";
import { knowledgeClaimKey, knowledgeClaimValue } from "./knowledge-lifecycle.js";

const id = "ddea26a2-ece1-4092-a0f3-02cf3d60bf81";
const otherId = "dcd0b001-42da-494d-9c6f-d3bb85e27bc7";

describe("knowledge claim identity", () => {
  const structuralClaims = (
    subject: string,
    object: string,
  ): KnowledgeRecordSnapshot["content"][] => [
    { kind: "goal", value: { goalId: subject } },
    {
      kind: "entity_meaning",
      value: { recordId: subject, meaning: "Example", purpose: "planning" },
    },
    {
      kind: "relationship",
      value: {
        subjectId: subject,
        objectId: object,
        relationship: "supports",
        direction: "directed",
      },
    },
  ];

  it("uses the same canonical structural key and value for both UUID casings", () => {
    const canonical = (content: KnowledgeRecordSnapshot["content"]) => [
      knowledgeClaimKey(null, content),
      knowledgeClaimValue(content),
    ];
    expect(structuralClaims(id, otherId).map(canonical)).toEqual(
      structuralClaims(id.toUpperCase(), otherId.toUpperCase()).map(canonical),
    );
    expect(structuralClaims(id, otherId).map(canonical)).not.toEqual(
      structuralClaims(otherId, id).map(canonical),
    );
  });
});
