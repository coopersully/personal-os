import { z } from "zod";
import { financeMonthSchema } from "./budget.js";

export const financeCompletionLimits = Object.freeze({
  targets: 10_000,
  rawTargets: 30_000,
  targetsPerChunk: 100,
  chunks: 100,
  targetBytes: 1_536,
  chunkBytes: 192 * 1_024,
  manifestBytes: 16 * 1_024 * 1_024,
  sourceAnchors: 4,
  batches: 200,
});
export const financeCompletionScope =
  "all_owned_transactions_flagged_and_open_or_deferred_cases" as const;
const id = z.uuid().transform((value) => value.toLowerCase());
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const snapshot = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine(
    (value) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n,
    "Revision exceeds PostgreSQL bigint.",
  );
const kind = z.enum(["transaction_flag", "review_case"]);
// Attribution is evidence: validate content without rewriting its original bytes.
const text = z
  .string()
  .min(1)
  .max(1_000)
  .refine((value) => value.trim().length > 0);

export const financeCompletionSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("labelled_relay"),
    instructionReference: text,
    relay: z.strictObject({ description: text }).optional(),
    financeMessageId: id.optional(),
  }),
  z.strictObject({
    kind: z.literal("owner_endpoint_request"),
    instructionReference: text,
    financeMessageId: id.optional(),
  }),
]);
export const financeCompletionBudgetRequirementSchema = z.strictObject({
  versionId: id,
  planId: id,
  version: z.number().int().positive().safe(),
  effectiveFrom: financeMonthSchema,
});

const observed = { capturedRevision: revision.nullable() };
export const financeCompletionSourceAnchorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("current_backlog"), snapshot, ...observed }),
  z.strictObject({
    kind: z.literal("historical_baseline"),
    snapshot,
    page: z.number().int().min(0).max(19),
    index: z.number().int().min(0).max(499),
    fingerprint: snapshot,
    ...observed,
  }),
  z.strictObject({
    kind: z.literal("review_batch"),
    id,
    fingerprint: hash,
    index: z.number().int().min(0).max(99),
    ...observed,
  }),
  z.strictObject({ kind: z.literal("audit"), id, ...observed }),
]);
export const financeCompletionTargetSchema = z
  .strictObject({
    kind,
    id,
    transactionId: id,
    ...observed,
    sourceAnchors: z
      .array(financeCompletionSourceAnchorSchema)
      .min(1)
      .max(financeCompletionLimits.sourceAnchors),
  })
  .superRefine((target, ctx) => {
    if (target.kind === "transaction_flag" && target.id !== target.transactionId)
      ctx.addIssue({ code: "custom", message: "A flag identifies its exact transaction." });
    const revisions = target.sourceAnchors.flatMap((anchor) =>
      anchor.capturedRevision === null ? [] : [anchor.capturedRevision],
    );
    if (revisions.some((value) => !revision.safeParse(value).success)) return;
    const earliest = revisions.sort(compareRevisions)[0] ?? null;
    if (target.capturedRevision !== earliest)
      ctx.addIssue({
        code: "custom",
        message: "Captured revision must retain the earliest source revision.",
      });
  });
export type FinanceCompletionTarget = z.infer<typeof financeCompletionTargetSchema>;
export type FinanceCompletionSource = z.infer<typeof financeCompletionSourceSchema>;

const historicalIdentity = z.strictObject({
  kind,
  id,
  transactionId: id,
  ...observed,
  fingerprint: snapshot,
});
const baseline = z
  .strictObject({
    scope: z.literal(financeCompletionScope),
    snapshot,
    total: z.number().int().min(0).max(financeCompletionLimits.targets),
    pages: z
      .array(
        z.strictObject({
          index: z.number().int().min(0).max(19),
          items: z.array(historicalIdentity).min(1).max(500),
        }),
      )
      .max(20),
  })
  .superRefine((value, ctx) => {
    let count = 0;
    const keys = new Set<string>();
    for (const [index, page] of value.pages.entries()) {
      if (page.index !== index || (index < value.pages.length - 1 && page.items.length !== 500))
        ctx.addIssue({
          code: "custom",
          message: "Baseline pages must be complete and contiguous.",
        });
      for (const item of page.items) {
        const key = `${item.kind}:${item.id}`;
        if (keys.has(key) || (item.kind === "transaction_flag" && item.id !== item.transactionId))
          ctx.addIssue({
            code: "custom",
            message: "Baseline contains duplicate or inconsistent identities.",
          });
        keys.add(key);
        count++;
      }
    }
    if (count !== value.total)
      ctx.addIssue({
        code: "custom",
        message: "Complete baseline total does not match its pages.",
      });
  });

/** Preserve the exact retained page item's fingerprint and position during expansion. */
export function deriveFinanceCompletionBaselineTargets(raw: unknown): FinanceCompletionTarget[] {
  const source = baseline.parse(raw);
  return source.pages.flatMap((page) =>
    page.items.map((item, index) => ({
      kind: item.kind,
      id: item.id,
      transactionId: item.transactionId,
      capturedRevision: item.capturedRevision,
      sourceAnchors: [
        {
          kind: "historical_baseline" as const,
          snapshot: source.snapshot,
          page: page.index,
          index,
          fingerprint: item.fingerprint,
          capturedRevision: item.capturedRevision,
        },
      ],
    })),
  );
}

/** Validate an expansion against the retained source, not just its self-consistent chunk hash. */
export function validateFinanceCompletionBaselineExpansion(
  rawSource: unknown,
  rawTargets: readonly unknown[],
) {
  const expected = deriveFinanceCompletionBaselineTargets(rawSource);
  const source = baseline.parse(rawSource);
  const actual = canonicalizeFinanceCompletionTargets(rawTargets).targets;
  const expectedEntries = expected
    .map((target) =>
      canonicalFinanceCompletionJson({
        kind: target.kind,
        id: target.id,
        transactionId: target.transactionId,
        anchor: target.sourceAnchors[0],
      }),
    )
    .sort();
  const actualEntries = actual
    .flatMap((target) =>
      target.sourceAnchors.flatMap((anchor) =>
        anchor.kind === "historical_baseline" && anchor.snapshot === source.snapshot
          ? [
              canonicalFinanceCompletionJson({
                kind: target.kind,
                id: target.id,
                transactionId: target.transactionId,
                anchor,
              }),
            ]
          : [],
      ),
    )
    .sort();
  if (
    canonicalFinanceCompletionJson(expectedEntries) !==
    canonicalFinanceCompletionJson(actualEntries)
  )
    throw new FinanceCompletionContractError("source_inconsistent");
  return actual;
}
export const requestFinanceCompletionInputSchema = z
  .strictObject({
    idempotencyKey: z.string().trim().min(1).max(200),
    budget: financeCompletionBudgetRequirementSchema,
    source: financeCompletionSourceSchema,
    historicalSources: z.strictObject({
      baseline: baseline.optional(),
      batches: z
        .array(z.strictObject({ id, fingerprint: hash }))
        .max(financeCompletionLimits.batches),
      auditTargets: z
        .array(
          z.strictObject({
            kind,
            id,
            auditIds: z.array(id).min(1).max(4),
            batchItem: z
              .strictObject({ batchId: id, index: z.number().int().min(0).max(99) })
              .optional(),
          }),
        )
        .max(financeCompletionLimits.targets),
    }),
  })
  .superRefine((input, ctx) => {
    // Enforce actual expanded/unique counts during canonicalization, not a batch-count
    // estimate that could reject a complete valid inventory before deduplication.
    try {
      if (bytes(canonicalFinanceCompletionJson(input)) > financeCompletionLimits.manifestBytes)
        ctx.addIssue({ code: "custom", message: "Completion request exceeds its byte bound." });
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Completion request must contain only JSON evidence.",
      });
    }
  });
export type RequestFinanceCompletionInput = z.infer<typeof requestFinanceCompletionInputSchema>;

/** Canonical input identity for idempotency; historical page positions remain source provenance. */
export function canonicalizeFinanceCompletionRequest(raw: unknown) {
  const input = requestFinanceCompletionInputSchema.parse(raw);
  const unique = <T>(values: T[]) =>
    [...new Map(values.map((value) => [canonicalFinanceCompletionJson(value), value])).entries()]
      .sort(([a], [b]) => compare(a, b))
      .map(([, value]) => value);
  const batchIds = new Map<string, string>();
  for (const batch of input.historicalSources.batches) {
    const previous = batchIds.get(batch.id);
    if (previous !== undefined && previous !== batch.fingerprint)
      throw new FinanceCompletionContractError("source_inconsistent");
    batchIds.set(batch.id, batch.fingerprint);
  }
  const normalized = {
    ...input,
    historicalSources: {
      ...input.historicalSources,
      batches: unique(input.historicalSources.batches),
      auditTargets: unique(
        input.historicalSources.auditTargets.map((target) => ({
          ...target,
          auditIds: [...new Set(target.auditIds)].sort(),
        })),
      ),
    },
  };
  return { input: normalized, canonical: canonicalFinanceCompletionJson(normalized) };
}

export class FinanceCompletionContractError extends Error {
  constructor(
    public readonly reason: "scope_exceeds_limit" | "evidence_too_large" | "source_inconsistent",
  ) {
    super(reason);
    this.name = "FinanceCompletionContractError";
  }
}

/** Stable JSON only. Undefined, prototypes, nonfinite numbers and cycles are not wire evidence. */
export function canonicalFinanceCompletionJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown, depth: number): string {
    if (depth > 32) throw new FinanceCompletionContractError("evidence_too_large");
    if (item === null || typeof item === "boolean" || typeof item === "string")
      return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== "object" || item === null || ancestors.has(item))
      throw new FinanceCompletionContractError("source_inconsistent");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        // Array holes must not hash as a different representation of missing evidence.
        const entries: string[] = [];
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !("value" in descriptor))
            throw new FinanceCompletionContractError("source_inconsistent");
          entries.push(encode(descriptor.value, depth + 1));
        }
        return `[${entries.join(",")}]`;
      }
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new FinanceCompletionContractError("source_inconsistent");
      if (Object.getOwnPropertySymbols(item).length)
        throw new FinanceCompletionContractError("source_inconsistent");
      return `{${Object.keys(item)
        .sort()
        .map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(item, key);
          if (!descriptor || !("value" in descriptor))
            throw new FinanceCompletionContractError("source_inconsistent");
          return `${JSON.stringify(key)}:${encode(descriptor.value, depth + 1)}`;
        })
        .join(",")}}`;
    } finally {
      ancestors.delete(item);
    }
  }
  return encode(value, 0);
}

function compareRevisions(a: string, b: string) {
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}
function bytes(value: string) {
  return new TextEncoder().encode(value).length;
}
function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Combine complete current capture and retained historical identities. Never slice away overflow. */
export function canonicalizeFinanceCompletionTargets(raw: readonly unknown[]) {
  if (raw.length > financeCompletionLimits.rawTargets)
    throw new FinanceCompletionContractError("scope_exceeds_limit");
  const byKey = new Map<string, FinanceCompletionTarget>();
  const provenance = new Map<string, string>();
  const effectSources = new Map<
    string,
    { transactionId: string; caseId: string | null; fingerprint: string | null }
  >();
  const batchFingerprints = new Map<string, string>();
  for (const candidate of raw) {
    const target = financeCompletionTargetSchema.parse(candidate);
    const key = `${target.kind}:${target.id}`;
    const previous = byKey.get(key);
    if (previous && previous.transactionId !== target.transactionId)
      throw new FinanceCompletionContractError("source_inconsistent");
    for (const anchor of target.sourceAnchors) {
      if (anchor.kind === "review_batch") {
        const fingerprint = batchFingerprints.get(anchor.id);
        if (fingerprint !== undefined && fingerprint !== anchor.fingerprint)
          throw new FinanceCompletionContractError("source_inconsistent");
        batchFingerprints.set(anchor.id, anchor.fingerprint);
      }
      if (anchor.kind === "review_batch" || anchor.kind === "audit") {
        const sourceKey = canonicalFinanceCompletionJson(
          anchor.kind === "review_batch"
            ? [anchor.kind, anchor.id, anchor.index]
            : [anchor.kind, anchor.id],
        );
        const retained = effectSources.get(sourceKey);
        const caseId = target.kind === "review_case" ? target.id : null;
        const fingerprint = anchor.kind === "review_batch" ? anchor.fingerprint : null;
        if (
          retained &&
          (retained.transactionId !== target.transactionId ||
            retained.fingerprint !== fingerprint ||
            (anchor.kind === "review_batch" &&
              retained.caseId !== null &&
              caseId !== null &&
              retained.caseId !== caseId))
        )
          throw new FinanceCompletionContractError("source_inconsistent");
        effectSources.set(sourceKey, {
          transactionId: target.transactionId,
          caseId: retained?.caseId ?? caseId,
          fingerprint,
        });
      }
      // A baseline page slot names one target globally. Audit/batch effects may legitimately
      // name both a flag and a case, with revisions in different per-target dimensions.
      const identity =
        anchor.kind === "historical_baseline"
          ? [anchor.kind, anchor.snapshot, anchor.page, anchor.index]
          : anchor.kind === "current_backlog"
            ? [anchor.kind, anchor.snapshot, key]
            : anchor.kind === "review_batch"
              ? [anchor.kind, anchor.id, anchor.index, key]
              : [anchor.kind, anchor.id, key];
      const identityKey = canonicalFinanceCompletionJson(identity);
      const metadata = canonicalFinanceCompletionJson({
        kind: target.kind,
        id: target.id,
        transactionId: target.transactionId,
        anchor,
      });
      const retained = provenance.get(identityKey);
      if (retained !== undefined && retained !== metadata)
        throw new FinanceCompletionContractError("source_inconsistent");
      provenance.set(identityKey, metadata);
    }
    const anchors = [
      ...new Map(
        [...(previous?.sourceAnchors ?? []), ...target.sourceAnchors].map((anchor) => [
          canonicalFinanceCompletionJson(anchor),
          anchor,
        ]),
      ).entries(),
    ]
      .sort(([a], [b]) => compare(a, b))
      .map(([, anchor]) => anchor);
    if (anchors.length > financeCompletionLimits.sourceAnchors)
      throw new FinanceCompletionContractError("evidence_too_large");
    const revisions = anchors.flatMap((anchor) =>
      anchor.capturedRevision === null ? [] : [anchor.capturedRevision],
    );
    const merged = {
      ...target,
      capturedRevision: revisions.sort(compareRevisions)[0] ?? null,
      sourceAnchors: anchors,
    };
    if (bytes(canonicalFinanceCompletionJson(merged)) > financeCompletionLimits.targetBytes)
      throw new FinanceCompletionContractError("evidence_too_large");
    byKey.set(key, merged);
    if (byKey.size > financeCompletionLimits.targets)
      throw new FinanceCompletionContractError("scope_exceeds_limit");
  }
  const targets = [...byKey.entries()].sort(([a], [b]) => compare(a, b)).map(([, value]) => value);
  const canonical = canonicalFinanceCompletionJson(targets);
  if (bytes(canonical) > financeCompletionLimits.manifestBytes)
    throw new FinanceCompletionContractError("evidence_too_large");
  const chunks = [];
  for (let offset = 0; offset < targets.length; offset += financeCompletionLimits.targetsPerChunk) {
    const items = targets.slice(offset, offset + financeCompletionLimits.targetsPerChunk);
    const chunk = canonicalFinanceCompletionJson(items);
    if (bytes(chunk) > financeCompletionLimits.chunkBytes)
      throw new FinanceCompletionContractError("evidence_too_large");
    chunks.push({ index: chunks.length, items, canonical: chunk });
  }
  return {
    scope: financeCompletionScope,
    targets,
    chunks,
    canonical,
    counts: {
      transactionFlags: targets.filter((target) => target.kind === "transaction_flag").length,
      reviewCases: targets.filter((target) => target.kind === "review_case").length,
    },
  };
}

const manifestRootSchema = z.strictObject({
  schemaVersion: z.literal(2),
  scope: z.literal(financeCompletionScope),
  targetCount: z.number().int().min(0).max(financeCompletionLimits.targets),
  counts: z.strictObject({
    transactionFlags: z.number().int().nonnegative(),
    reviewCases: z.number().int().nonnegative(),
  }),
  chunkHashes: z.array(hash).max(financeCompletionLimits.chunks),
  manifestHash: hash,
});
const manifestChunkSchema = z.strictObject({
  index: z.number().int().min(0).max(99),
  previousHash: hash.nullable(),
  hash,
  items: z.array(financeCompletionTargetSchema).min(1).max(financeCompletionLimits.targetsPerChunk),
});

/** The API supplies its SHA-256 implementation; no Node dependency or package export is needed here. */
export function sealFinanceCompletionManifest(
  raw: readonly unknown[],
  digest: (canonical: string) => string,
) {
  const manifest = canonicalizeFinanceCompletionTargets(raw);
  const chunks: Array<z.infer<typeof manifestChunkSchema>> = [];
  let previousHash: string | null = null;
  for (const chunk of manifest.chunks) {
    const value = { index: chunk.index, previousHash, items: chunk.items };
    const chunkHash = hash.parse(digest(canonicalFinanceCompletionJson(value)));
    chunks.push({ ...value, hash: chunkHash });
    previousHash = chunkHash;
  }
  const root = {
    schemaVersion: 2 as const,
    scope: financeCompletionScope,
    targetCount: manifest.targets.length,
    counts: manifest.counts,
    chunkHashes: chunks.map((chunk) => chunk.hash),
  };
  return {
    root: { ...root, manifestHash: hash.parse(digest(canonicalFinanceCompletionJson(root))) },
    chunks,
  };
}

/** Verify retained PostgreSQL root/chunks in memory; this is not a historical-authenticity assertion. */
export function validateFinanceCompletionManifestEvidence(
  rawRoot: unknown,
  rawChunks: readonly unknown[],
  digest: (canonical: string) => string,
) {
  const root = manifestRootSchema.parse(rawRoot);
  if (rawChunks.length > financeCompletionLimits.chunks)
    throw new FinanceCompletionContractError("evidence_too_large");
  const chunks = rawChunks.map((chunk) => manifestChunkSchema.parse(chunk));
  const verified = sealFinanceCompletionManifest(
    chunks.flatMap((chunk) => chunk.items),
    digest,
  );
  if (
    canonicalFinanceCompletionJson(root) !== canonicalFinanceCompletionJson(verified.root) ||
    canonicalFinanceCompletionJson(chunks) !== canonicalFinanceCompletionJson(verified.chunks)
  )
    throw new FinanceCompletionContractError("source_inconsistent");
  return verified;
}

const captureMetadata = {
  queryVersion: z.literal("finance-completion-capture:v2"),
  ownerId: id,
  snapshot,
  complete: z.literal(true),
  targetCount: z.number().int().min(0).max(financeCompletionLimits.targets),
  counts: z.strictObject({
    transactionFlags: z.number().int().nonnegative(),
    reviewCases: z.number().int().nonnegative(),
  }),
  pageCount: z.number().int().min(1).max(21),
  terminalPage: z.strictObject({
    after: z.string().max(80).nullable(),
    rowCount: z.number().int().min(0).max(499),
  }),
};
/** Empty is a positive query result with metadata, never an omitted array or default. */
export const financeCompletionCaptureSchema = z
  .strictObject({
    ...captureMetadata,
    targets: z.array(financeCompletionTargetSchema).max(financeCompletionLimits.targets),
  })
  .superRefine((capture, ctx) => {
    const fail = () =>
      ctx.addIssue({
        code: "custom",
        message: "Capture completeness or source metadata is inconsistent.",
      });
    if (
      capture.targetCount !== capture.targets.length ||
      capture.counts.transactionFlags !==
        capture.targets.filter((target) => target.kind === "transaction_flag").length ||
      capture.counts.reviewCases !==
        capture.targets.filter((target) => target.kind === "review_case").length ||
      capture.pageCount !== Math.floor(capture.targetCount / 500) + 1 ||
      capture.terminalPage.rowCount !== capture.targetCount % 500
    )
      fail();
    const terminalOffset = (capture.pageCount - 1) * 500 - 1;
    const preceding = capture.targets[terminalOffset];
    if (capture.terminalPage.after !== (preceding ? `${preceding.kind}:${preceding.id}` : null))
      fail();
    let previous = "";
    for (const target of capture.targets) {
      const key = `${target.kind}:${target.id}`;
      if (key <= previous) fail();
      previous = key;
      const anchor = target.sourceAnchors[0];
      if (
        target.capturedRevision === null ||
        target.sourceAnchors.length !== 1 ||
        anchor?.kind !== "current_backlog" ||
        anchor.snapshot !== capture.snapshot ||
        anchor.capturedRevision !== target.capturedRevision
      )
        fail();
    }
  });
const captureRootSchema = z.strictObject({
  ...captureMetadata,
  manifestHash: hash,
  captureHash: hash,
});

export function sealFinanceCompletionCapture(raw: unknown, digest: (canonical: string) => string) {
  const capture = financeCompletionCaptureSchema.parse(raw);
  const rows = capture.targets.map((target) => ({
    userId: capture.ownerId,
    kind: target.kind,
    id: target.id,
    transactionId: target.transactionId,
    contextualRevision: target.capturedRevision,
  }));
  const expectedSnapshot = hash
    .parse(digest(JSON.stringify([capture.queryVersion, capture.ownerId, rows])))
    .slice(7);
  if (capture.snapshot !== expectedSnapshot)
    throw new FinanceCompletionContractError("source_inconsistent");
  const { targets, ...metadata } = capture;
  const manifest = sealFinanceCompletionManifest(targets, digest);
  const root = { ...metadata, manifestHash: manifest.root.manifestHash };
  return {
    root: { ...root, captureHash: hash.parse(digest(canonicalFinanceCompletionJson(root))) },
    manifest,
  };
}

/** Reconstruct the complete capture from retained metadata and its separately chunked targets. */
export function validateFinanceCompletionCaptureEvidence(
  rawCaptureRoot: unknown,
  rawManifestRoot: unknown,
  rawChunks: readonly unknown[],
  digest: (canonical: string) => string,
) {
  const root = captureRootSchema.parse(rawCaptureRoot);
  const manifest = validateFinanceCompletionManifestEvidence(rawManifestRoot, rawChunks, digest);
  const { captureHash: _captureHash, manifestHash: _manifestHash, ...metadata } = root;
  const verified = sealFinanceCompletionCapture(
    { ...metadata, targets: manifest.chunks.flatMap((chunk) => chunk.items) },
    digest,
  );
  if (canonicalFinanceCompletionJson(verified.root) !== canonicalFinanceCompletionJson(root))
    throw new FinanceCompletionContractError("source_inconsistent");
  return verified;
}
