import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalFinanceCompletionJson,
  canonicalizeFinanceCompletionRequest,
  canonicalizeFinanceCompletionTargets,
  deriveFinanceCompletionBaselineTargets,
  financeCompletionScope,
  financeCompletionTargetSchema,
  requestFinanceCompletionInputSchema,
  sealFinanceCompletionManifest,
  sealFinanceCompletionCapture,
  validateFinanceCompletionCaptureEvidence,
  validateFinanceCompletionBaselineExpansion,
  validateFinanceCompletionManifestEvidence,
} from "./completion.js";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const snapshot = "a".repeat(64);
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function target(n: number) {
  return {
    kind: "transaction_flag" as const,
    id: id(n),
    transactionId: id(n),
    capturedRevision: "1",
    sourceAnchors: [{ kind: "current_backlog" as const, snapshot, capturedRevision: "1" }],
  };
}
function request() {
  return {
    idempotencyKey: "completion-request",
    budget: { versionId: id(1), planId: id(2), version: 3, effectiveFrom: "2026-10" },
    source: {
      kind: "labelled_relay",
      instructionReference: "owner instruction",
      relay: { description: "Relayed by owner session" },
    },
    historicalSources: { batches: [], auditTargets: [] },
  };
}

describe("completion canonical budget month", () => {
  it("retains the canonical October month without first-of-month conversion", () => {
    const parsed = requestFinanceCompletionInputSchema.parse(request());
    expect(parsed.budget.effectiveFrom).toBe("2026-10");
  });
  it("rejects dates and malformed budget months at request admission", () => {
    for (const effectiveFrom of [
      "2026-10-01",
      "2026-00",
      "2026-13",
      "2026-1",
      "26-10",
      "2026-10T00:00:00Z",
      " 2026-10",
      "2026-10 ",
      "",
      null,
    ]) {
      const input = request();
      expect(
        requestFinanceCompletionInputSchema.safeParse({
          ...input,
          budget: { ...input.budget, effectiveFrom },
        }).success,
      ).toBe(false);
    }
  });
});

describe("completion capture evidence including zero", () => {
  function capture(count: number) {
    const ownerId = id(9000);
    const targets = Array.from({ length: count }, (_, index) => target(index + 1));
    const rows = targets.map((item) => ({
      userId: ownerId,
      kind: item.kind,
      id: item.id,
      transactionId: item.transactionId,
      contextualRevision: item.capturedRevision,
    }));
    const captureSnapshot = digest(
      JSON.stringify(["finance-completion-capture:v2", ownerId, rows]),
    ).slice(7);
    return {
      queryVersion: "finance-completion-capture:v2",
      ownerId,
      snapshot: captureSnapshot,
      complete: true,
      targetCount: count,
      counts: { transactionFlags: count, reviewCases: 0 },
      pageCount: 1,
      terminalPage: { after: null, rowCount: count },
      targets: targets.map((item) => ({
        ...item,
        sourceAnchors: [
          {
            kind: "current_backlog",
            snapshot: captureSnapshot,
            capturedRevision: item.capturedRevision,
          },
        ],
      })),
    };
  }
  it("seals a complete zero capture independently of its empty target chunks", () => {
    const sealed = sealFinanceCompletionCapture(capture(0), digest);
    expect(sealed.root).toMatchObject({
      complete: true,
      targetCount: 0,
      pageCount: 1,
      terminalPage: { after: null, rowCount: 0 },
      snapshot: capture(0).snapshot,
    });
    expect(sealed.manifest.chunks).toHaveLength(0);
    expect(
      validateFinanceCompletionCaptureEvidence(sealed.root, sealed.manifest.root, [], digest),
    ).toEqual(sealed);
    expect(() => sealFinanceCompletionCapture([], digest)).toThrow();
    expect(() => sealFinanceCompletionCapture(undefined, digest)).toThrow();
    expect(() =>
      sealFinanceCompletionCapture({ ...capture(0), complete: false }, digest),
    ).toThrow();
    expect(() => sealFinanceCompletionCapture({ ...capture(0), pageCount: 0 }, digest)).toThrow();
  });
  it("rejects missing/noncomplete capture, wrong counts/terminal observation and changed snapshot", () => {
    const valid = capture(1);
    const sealed = sealFinanceCompletionCapture(valid, digest);
    expect(
      validateFinanceCompletionCaptureEvidence(
        sealed.root,
        sealed.manifest.root,
        sealed.manifest.chunks,
        digest,
      ),
    ).toEqual(sealed);
    expect(() => sealFinanceCompletionCapture({ ...valid, targetCount: 0 }, digest)).toThrow();
    expect(() =>
      sealFinanceCompletionCapture(
        { ...valid, terminalPage: { after: null, rowCount: 0 } },
        digest,
      ),
    ).toThrow();
    expect(() => sealFinanceCompletionCapture({ ...valid, snapshot }, digest)).toThrow();
    expect(() =>
      validateFinanceCompletionCaptureEvidence(
        undefined,
        sealed.manifest.root,
        sealed.manifest.chunks,
        digest,
      ),
    ).toThrow();
    expect(() =>
      validateFinanceCompletionCaptureEvidence(
        { ...sealed.root, complete: false },
        sealed.manifest.root,
        sealed.manifest.chunks,
        digest,
      ),
    ).toThrow();
  });
});

describe("Finance completion wire contract", () => {
  it("retains exact instruction bytes and permits an optional relay descriptor", () => {
    const input = request();
    const reference = "  original instruction\n";
    const withSource = (instructionReference: string) => ({
      ...input,
      source: { kind: "labelled_relay", instructionReference },
    });
    const parsed = canonicalizeFinanceCompletionRequest(withSource(reference));
    expect(parsed.input.source.instructionReference).toBe(reference);
    expect(parsed.input.source.kind).toBe("labelled_relay");
    expect(parsed.canonical).not.toBe(
      canonicalizeFinanceCompletionRequest(withSource(reference.trim())).canonical,
    );
    expect(requestFinanceCompletionInputSchema.safeParse(withSource(" \n\t ")).success).toBe(false);
    const description = "  relayed without rewriting  ";
    expect(
      canonicalizeFinanceCompletionRequest({
        ...withSource(reference),
        source: {
          kind: "labelled_relay",
          instructionReference: reference,
          relay: { description },
        },
      }).input.source,
    ).toMatchObject({ relay: { description } });
  });
  it("does not admit a scope subset, invented satisfaction, authority or human-origin assertion", () => {
    expect(requestFinanceCompletionInputSchema.safeParse(request()).success).toBe(true);
    for (const extra of [
      { scope: "snapshot" },
      { completed: true },
      { actorId: id(9) },
      { humanProof: true },
    ])
      expect(
        requestFinanceCompletionInputSchema.safeParse({ ...request(), ...extra }).success,
      ).toBe(false);
    expect(
      requestFinanceCompletionInputSchema.safeParse({
        ...request(),
        source: { ...request().source, humanProof: true },
      }).success,
    ).toBe(false);
    expect(
      requestFinanceCompletionInputSchema.safeParse({
        ...request(),
        source: { ...request().source, financeMessageId: undefined },
      }).success,
    ).toBe(false);
  });

  it("rejects incomplete, duplicate and missing historical baseline pages", () => {
    const item = {
      kind: "transaction_flag",
      id: id(1),
      transactionId: id(1),
      capturedRevision: "1",
      fingerprint: snapshot,
    };
    const parse = (total: number, pages: unknown[]) =>
      requestFinanceCompletionInputSchema.safeParse({
        ...request(),
        historicalSources: {
          ...request().historicalSources,
          baseline: { scope: financeCompletionScope, snapshot, total, pages },
        },
      }).success;
    expect(parse(1, [{ index: 0, items: [item] }])).toBe(true);
    expect(parse(2, [{ index: 0, items: [item] }])).toBe(false);
    expect(parse(2, [{ index: 0, items: [item, item] }])).toBe(false);
    expect(parse(1, [{ index: 1, items: [item] }])).toBe(false);
    expect(parse(0, [])).toBe(true);
  });

  it("never invents a historical revision or swaps flag identity", () => {
    expect(
      financeCompletionTargetSchema.safeParse({ ...target(1), capturedRevision: "2" }).success,
    ).toBe(false);
    expect(
      financeCompletionTargetSchema.safeParse({ ...target(1), transactionId: id(2) }).success,
    ).toBe(false);
    const missing = {
      ...target(1),
      capturedRevision: null,
      sourceAnchors: [{ kind: "audit", id: id(4), capturedRevision: null }],
    };
    expect(canonicalizeFinanceCompletionTargets([missing]).targets[0]?.capturedRevision).toBeNull();
    for (const capturedRevision of ["not-a-revision", "0", "9223372036854775808"])
      expect(
        financeCompletionTargetSchema.safeParse({ ...target(1), capturedRevision }).success,
      ).toBe(false);
  });

  it("canonicalizes source ordering and conflicts on one saved batch with two fingerprints", () => {
    const batch = { id: id(10), fingerprint: `sha256:${snapshot}` };
    const a = request();
    const first = { ...a, historicalSources: { ...a.historicalSources, batches: [batch, batch] } };
    const second = { ...a, historicalSources: { ...a.historicalSources, batches: [batch] } };
    expect(canonicalizeFinanceCompletionRequest(first).canonical).toBe(
      canonicalizeFinanceCompletionRequest(second).canonical,
    );
    expect(() =>
      canonicalizeFinanceCompletionRequest({
        ...a,
        historicalSources: {
          ...a.historicalSources,
          batches: [batch, { ...batch, fingerprint: `sha256:${"b".repeat(64)}` }],
        },
      }),
    ).toThrow("source_inconsistent");
  });
});

describe("complete canonical Finance completion manifests", () => {
  it("carries every baseline item fingerprint through expansion/sealing and rejects substitution", () => {
    const source = {
      scope: financeCompletionScope,
      snapshot,
      total: 1,
      pages: [
        {
          index: 0,
          items: [
            {
              kind: "transaction_flag",
              id: id(1),
              transactionId: id(1),
              capturedRevision: "1",
              fingerprint: "b".repeat(64),
            },
          ],
        },
      ],
    };
    const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
    const expanded = deriveFinanceCompletionBaselineTargets(source);
    const retained = sealFinanceCompletionManifest(expanded, digest);
    expect(retained.chunks[0]?.items[0]?.sourceAnchors[0]).toMatchObject({
      kind: "historical_baseline",
      snapshot,
      page: 0,
      index: 0,
      fingerprint: "b".repeat(64),
    });
    expect(validateFinanceCompletionBaselineExpansion(source, expanded)).toHaveLength(1);
    const changed = deriveFinanceCompletionBaselineTargets({
      ...source,
      pages: [
        {
          index: 0,
          items: [
            {
              ...source.pages[0]?.items[0],
              fingerprint: "c".repeat(64),
            },
          ],
        },
      ],
    });
    expect(sealFinanceCompletionManifest(changed, digest).root.manifestHash).not.toBe(
      retained.root.manifestHash,
    );
    expect(sealFinanceCompletionManifest(changed, digest).chunks[0]?.hash).not.toBe(
      retained.chunks[0]?.hash,
    );
    expect(() => validateFinanceCompletionBaselineExpansion(source, changed)).toThrow(
      "source_inconsistent",
    );
    expect(() => validateFinanceCompletionBaselineExpansion(source, [])).toThrow(
      "source_inconsistent",
    );
    expect(() =>
      sealFinanceCompletionManifest(
        [
          {
            ...target(1),
            sourceAnchors: [
              {
                kind: "historical_baseline",
                snapshot,
                page: 0,
                index: 0,
                capturedRevision: "1",
              },
            ],
          },
        ],
        digest,
      ),
    ).toThrow();
  });

  it("rejects contradictory metadata for the same provenance identity rather than lowering its revision", () => {
    const a = {
      ...target(1),
      capturedRevision: "5",
      sourceAnchors: [{ kind: "audit", id: id(5), capturedRevision: "5" }],
    };
    expect(() =>
      canonicalizeFinanceCompletionTargets([
        a,
        {
          ...a,
          capturedRevision: "9",
          sourceAnchors: [{ kind: "audit", id: id(5), capturedRevision: "9" }],
        },
      ]),
    ).toThrow("source_inconsistent");
    const batch = {
      ...target(1),
      sourceAnchors: [
        {
          kind: "review_batch",
          id: id(8),
          index: 0,
          fingerprint: `sha256:${snapshot}`,
          capturedRevision: "1",
        },
      ],
    };
    expect(() =>
      canonicalizeFinanceCompletionTargets([
        batch,
        {
          ...batch,
          sourceAnchors: [
            {
              ...batch.sourceAnchors[0],
              fingerprint: `sha256:${"b".repeat(64)}`,
            },
          ],
        },
      ]),
    ).toThrow("source_inconsistent");
    expect(() =>
      canonicalizeFinanceCompletionTargets([
        batch,
        {
          ...batch,
          capturedRevision: "2",
          sourceAnchors: [
            {
              ...batch.sourceAnchors[0],
              capturedRevision: "2",
            },
          ],
        },
      ]),
    ).toThrow("source_inconsistent");
    expect(() =>
      canonicalizeFinanceCompletionTargets([
        target(1),
        {
          ...target(1),
          capturedRevision: "9",
          sourceAnchors: [
            {
              kind: "current_backlog",
              snapshot,
              capturedRevision: "9",
            },
          ],
        },
      ]),
    ).toThrow("source_inconsistent");
    expect(canonicalizeFinanceCompletionTargets([a, a]).targets[0]?.sourceAnchors).toHaveLength(1);
  });

  it("rejects a retained baseline slot reused by another target or conflicting item metadata", () => {
    const anchor = {
      kind: "historical_baseline",
      snapshot,
      page: 0,
      index: 0,
      fingerprint: snapshot,
      capturedRevision: "1",
    };
    const first = { ...target(1), sourceAnchors: [anchor] };
    expect(() =>
      canonicalizeFinanceCompletionTargets([first, { ...target(2), sourceAnchors: [anchor] }]),
    ).toThrow("source_inconsistent");
    expect(() =>
      canonicalizeFinanceCompletionTargets([
        first,
        {
          ...first,
          sourceAnchors: [
            {
              ...anchor,
              fingerprint: "b".repeat(64),
            },
          ],
        },
      ]),
    ).toThrow("source_inconsistent");
  });

  it("keeps batch case and flag revision dimensions separate while checking each provenance identity", () => {
    const anchor = {
      kind: "review_batch",
      id: id(8),
      index: 0,
      fingerprint: `sha256:${snapshot}`,
      capturedRevision: "1",
    };
    expect(
      canonicalizeFinanceCompletionTargets([
        { ...target(1), sourceAnchors: [anchor] },
        {
          ...target(2),
          kind: "review_case",
          transactionId: id(1),
          capturedRevision: "9",
          sourceAnchors: [{ ...anchor, capturedRevision: "9" }],
        },
      ]).targets,
    ).toHaveLength(2);
    expect(() =>
      canonicalizeFinanceCompletionTargets([
        { ...target(1), sourceAnchors: [anchor] },
        {
          ...target(2),
          kind: "review_case",
          transactionId: id(1),
          sourceAnchors: [
            {
              ...anchor,
              fingerprint: `sha256:${"b".repeat(64)}`,
            },
          ],
        },
      ]),
    ).toThrow("source_inconsistent");
  });
  it("retains 2801 targets plus historical work and keeps case and flag separate", () => {
    const current = Array.from({ length: 2801 }, (_, index) => target(index + 1));
    const historical = {
      ...target(3000),
      sourceAnchors: [{ kind: "audit" as const, id: id(8000), capturedRevision: "1" }],
    };
    const review = { ...target(1), kind: "review_case" as const };
    const manifest = canonicalizeFinanceCompletionTargets([...current, historical, review]);
    expect(manifest.targets).toHaveLength(2803);
    expect(manifest.chunks).toHaveLength(29);
    expect(manifest.counts).toEqual({ transactionFlags: 2802, reviewCases: 1 });
    expect(manifest.chunks.flatMap((chunk) => chunk.items)).toEqual(manifest.targets);
  });

  it("accepts 10000 and rejects limit+1 without returning a truncated success", () => {
    const full = Array.from({ length: 10_000 }, (_, index) => target(index + 1));
    expect(canonicalizeFinanceCompletionTargets(full).chunks).toHaveLength(100);
    expect(() => canonicalizeFinanceCompletionTargets([...full, target(10_001)])).toThrow(
      "scope_exceeds_limit",
    );
  });

  it("is stable across source ordering and object key ordering while retaining earliest real revision", () => {
    const later = {
      ...target(1),
      capturedRevision: "9",
      sourceAnchors: [{ kind: "audit" as const, id: id(5), capturedRevision: "9" }],
    };
    const a = canonicalizeFinanceCompletionTargets([later, target(2), target(1), target(1)]);
    const b = canonicalizeFinanceCompletionTargets([target(1), target(2), later]);
    expect(a.canonical).toBe(b.canonical);
    expect(a.targets[0]?.capturedRevision).toBe("1");
    expect(canonicalFinanceCompletionJson({ b: 2, a: [1] })).toBe('{"a":[1],"b":2}');
  });

  it("does not merge incompatible transaction references or silently drop provenance anchors", () => {
    const original = { ...target(1), kind: "review_case" as const };
    expect(() =>
      canonicalizeFinanceCompletionTargets([original, { ...original, transactionId: id(2) }]),
    ).toThrow("source_inconsistent");
    const sources = Array.from({ length: 5 }, (_, n) => ({
      ...target(1),
      sourceAnchors: [{ kind: "audit", id: id(n + 20), capturedRevision: "1" }],
    }));
    expect(() => canonicalizeFinanceCompletionTargets(sources)).toThrow("evidence_too_large");
  });

  it("rejects lossy or executable JSON values instead of hashing fabricated evidence", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    for (const value of [
      undefined,
      NaN,
      Infinity,
      new Date(),
      cycle,
      [, 1],
      { a: undefined },
      {
        get a() {
          throw new Error("getter executed");
        },
      },
    ])
      expect(() => canonicalFinanceCompletionJson(value)).toThrow();
    expect(canonicalFinanceCompletionJson({ a: null })).toBe('{"a":null}');
  });

  it("seals every chunk and rejects missing, changed, reordered or detached runtime evidence", () => {
    const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
    const targets = Array.from({ length: 201 }, (_, index) => target(index + 1));
    const sealed = sealFinanceCompletionManifest(targets, digest);
    expect(sealed.chunks).toHaveLength(3);
    expect(validateFinanceCompletionManifestEvidence(sealed.root, sealed.chunks, digest)).toEqual(
      sealed,
    );
    expect(() =>
      validateFinanceCompletionManifestEvidence(sealed.root, sealed.chunks.slice(1), digest),
    ).toThrow();
    expect(() =>
      validateFinanceCompletionManifestEvidence(sealed.root, [...sealed.chunks].reverse(), digest),
    ).toThrow();
    expect(() =>
      validateFinanceCompletionManifestEvidence(
        { ...sealed.root, targetCount: 200 },
        sealed.chunks,
        digest,
      ),
    ).toThrow();
    const first = sealed.chunks[0];
    if (!first) throw new Error("Missing chunk");
    expect(() =>
      validateFinanceCompletionManifestEvidence(
        sealed.root,
        [{ ...first, previousHash: `sha256:${"a".repeat(64)}` }, ...sealed.chunks.slice(1)],
        digest,
      ),
    ).toThrow();
    expect(sealFinanceCompletionManifest([...targets].reverse(), digest)).toEqual(sealed);
  });
});
