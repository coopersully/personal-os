import type { Database } from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgeLifecycleInput,
  type KnowledgeMutationResult,
  type KnowledgeRecordSnapshot,
  knowledgeAgentLifecycleInputSchema,
  knowledgeClaimContent,
  knowledgeClaimKey,
  knowledgeLifecycleInputSchema,
} from "@personal-os/domain";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import {
  bumpKnowledgeEpoch,
  createKnowledgeAccess,
  type KnowledgeRevision,
  type KnowledgeTransaction,
  knowledgeRevisionDerivations,
  linkedProposalIds,
  ownedKnowledgeRevision,
  requireKnowledgeOwner,
} from "./access.js";
import {
  assertReferenceAcyclic,
  findKnowledgeReceipt,
  knowledgeRequestHash,
  knowledgeWriteScopes,
  ownerKnowledgeAcceptance,
  prepareKnowledgeRevision,
  presentKnowledgeReceipt,
  type RevisionWrite,
  saveKnowledgeSidecar,
  writeKnowledgeAudit,
  writeKnowledgeReceipt,
  writeKnowledgeRevision,
} from "./record-service.js";
import { createKnowledgeTrashService } from "./trash-service.js";

/** Agents manage memory; every other action is the person's override. */
const agentActions = new Set<KnowledgeLifecycleInput["action"]>(
  knowledgeAgentLifecycleInputSchema.options.map((schema) => schema.shape.action.value),
);
/** A pending proposal waits for the person; an agent may only withdraw or narrow it. */
const agentProposalActions = new Set<KnowledgeLifecycleInput["action"]>([
  "supersede",
  "restrict",
  "raise_sensitivity",
]);
/**
 * Actions that would detach a pending proposal from its conflict: a confirmed, revised or
 * disputed proposal stops being `proposed`, so `resolve_conflict` could no longer retire the
 * record it proposes to change. The person resolves the conflict first.
 */
const proposalResolutionFirst = new Set<KnowledgeLifecycleInput["action"]>([
  "revise",
  "dispute",
  "confirm",
]);

async function validateSupersession(
  tx: KnowledgeTransaction,
  principal: Principal,
  recordId: string,
  replacementId: string,
) {
  const visited = new Set([recordId]);
  let next: string | null = replacementId;
  while (next) {
    if (visited.has(next)) throw new AppError("conflict", "Supersession cannot form a cycle.");
    visited.add(next);
    const revision = await ownedKnowledgeRevision(tx, principal, next);
    next = revision.metadata.supersededBy;
  }
}

/** Memory the person holds, or whose dispute the person raised, changes only by proposal. */
function heldByOwner({ ownerHeld, metadata }: KnowledgeRevision) {
  return ownerHeld || metadata.acceptance?.kind === "owner" || metadata.disputedBy === "user";
}

function nextRevision(
  current: KnowledgeRevision,
  derivations: RevisionWrite["derivations"],
): RevisionWrite {
  const { snapshot, metadata, claimKey, ownerHeld, core } = current;
  return {
    snapshot: { ...snapshot, revision: snapshot.revision + 1 },
    metadata: { ...metadata },
    claimKey,
    derivations,
    newSources: [],
    record: { ownerHeld, core },
  };
}

function workspaceScope(workspace: KnowledgeRecordSnapshot["scope"]["workspace"]) {
  return workspace ? ([`${workspace}:read`] satisfies AccessScope[]) : [];
}

export function createKnowledgeLifecycleService({ db, now }: { db: Database; now: () => Date }) {
  const access = createKnowledgeAccess(now);
  const trash = createKnowledgeTrashService({ db, now });

  function rescope(
    write: RevisionWrite,
    current: KnowledgeRevision,
    workspace: KnowledgeRecordSnapshot["scope"]["workspace"],
  ) {
    const { snapshot, metadata } = current;
    const previous = new Set<AccessScope>(workspaceScope(snapshot.scope.workspace));
    write.snapshot.scope = { workspace };
    write.snapshot.requiredReadScopes = [
      ...new Set([
        ...snapshot.requiredReadScopes.filter((scope) => !previous.has(scope)),
        ...workspaceScope(workspace),
      ]),
    ].sort();
    write.claimKey = knowledgeClaimKey(
      workspace,
      knowledgeClaimContent(snapshot, metadata.generatedInference),
    );
  }

  /**
   * An agent superseding memory the person holds proposes its replacement instead: the
   * replacement waits as a linked proposal and the person's record stays as it is.
   */
  async function proposeReplacement(
    tx: KnowledgeTransaction,
    principal: Principal,
    current: KnowledgeRevision,
    replacement: KnowledgeRevision,
  ): Promise<RevisionWrite> {
    if (heldByOwner(replacement))
      throw new AppError("forbidden", "The account owner must supersede memory they hold.");
    if (replacement.snapshot.status !== "active")
      throw new AppError("conflict", "Only active memory can be proposed as a replacement.");
    await assertReferenceAcyclic(tx, principal.userId, current, replacement.snapshot.id);
    const derivations = await knowledgeRevisionDerivations(tx, principal.userId, replacement);
    if (!replacement.hasSidecar)
      await saveKnowledgeSidecar(tx, principal.userId, replacement, derivations);
    const write = nextRevision(replacement, [
      ...derivations,
      {
        sourceRecordId: current.snapshot.id,
        sourceRevision: current.snapshot.revision,
        kind: "revision_proposal",
      },
    ]);
    write.snapshot.status = "proposed";
    write.metadata.inheritedRecordIds = [
      ...new Set([...replacement.metadata.inheritedRecordIds, current.snapshot.id]),
    ];
    return write;
  }

  /** Activate the proposal and supersede every record it proposed to change. */
  async function acceptProposal(
    tx: KnowledgeTransaction,
    principal: Principal,
    proposal: KnowledgeRevision,
    originalIds: string[],
    write: RevisionWrite,
    at: Date,
  ) {
    write.snapshot.status = "active";
    write.metadata.acceptance = ownerKnowledgeAcceptance(principal, proposal.snapshot.sources, at);
    write.metadata.disputedBy = null;
    write.record = { ...write.record, ownerHeld: true, lastConfirmedAt: at };
    const superseded: RevisionWrite[] = [];
    for (const id of originalIds) {
      const original = await ownedKnowledgeRevision(tx, principal, id, true);
      // Another proposal already replaced it; activating this one too would leave two.
      if (original.snapshot.status === "superseded")
        throw new AppError("conflict", "Another memory already replaced the original.");
      await validateSupersession(tx, principal, id, proposal.snapshot.id);
      const derivations = await knowledgeRevisionDerivations(tx, principal.userId, original);
      if (!original.hasSidecar)
        await saveKnowledgeSidecar(tx, principal.userId, original, derivations);
      const retired = nextRevision(original, derivations);
      retired.snapshot.status = "superseded";
      retired.metadata.supersededBy = proposal.snapshot.id;
      superseded.push(retired);
    }
    return superseded;
  }

  return {
    async mutate(
      principal: Principal,
      raw: KnowledgeLifecycleInput,
    ): Promise<KnowledgeMutationResult> {
      const input = knowledgeLifecycleInputSchema.parse(raw);
      if (input.action === "trash" || input.action === "restore" || input.action === "delete_now") {
        const { action, ...identity } = input;
        if (action === "trash") return trash.trash(principal, identity);
        if (action === "restore") return trash.restore(principal, identity);
        return trash.deleteNow(principal, identity);
      }
      if (!agentActions.has(input.action)) requireKnowledgeOwner(principal);
      const requestHash = knowledgeRequestHash(principal, input);
      return db.transaction(async (tx) => {
        await access.admit(tx, principal, knowledgeWriteScopes);
        const prior = await findKnowledgeReceipt(tx, principal, input.mutationKey, requestHash);
        if (prior) return presentKnowledgeReceipt(tx, access, principal, prior);

        const current = await ownedKnowledgeRevision(tx, principal, input.recordId, true);
        const { snapshot, metadata } = current;
        await access.disclose(tx, principal, current);
        if (snapshot.revision !== input.expectedRevision)
          throw new AppError("conflict", "The knowledge revision changed.", {
            current: await access.present(tx, principal, current),
          });
        if (snapshot.status === "superseded")
          throw new AppError("conflict", "Superseded knowledge can only be inspected.");
        const agent = principal.actorType === "agent";
        if (agent && metadata.disputedBy === "user" && input.action !== "revise")
          throw new AppError("forbidden", "The account owner must resolve this dispute.");
        if (agent && snapshot.status === "proposed" && !agentProposalActions.has(input.action))
          throw new AppError("conflict", "The account owner must resolve this proposal.");
        if (snapshot.status === "proposed" && proposalResolutionFirst.has(input.action))
          throw new AppError("conflict", "Resolve this proposal with resolve_conflict first.");

        const at = now();
        const derivations = await knowledgeRevisionDerivations(tx, principal.userId, current);
        let write = nextRevision(current, derivations);
        let related: RevisionWrite[] = [];
        switch (input.action) {
          case "revise":
            write = await prepareKnowledgeRevision({
              tx,
              access,
              principal,
              at,
              current,
              replaceEvidence: input.evidence !== undefined,
              asProposal: agent && heldByOwner(current),
              input: {
                mutationKey: input.mutationKey,
                content: input.content,
                scope: snapshot.scope,
                sensitivity: snapshot.sensitivity,
                purposes: snapshot.purposes,
                core: input.core ?? current.core,
                tags: input.tags ?? current.tags,
                evidence: input.evidence ?? [],
                relatedRecordIds: input.relatedRecordIds ?? snapshot.relatedRecordIds,
                ...(input.validity ? { validity: input.validity } : {}),
              },
            });
            break;
          case "dispute":
            write.snapshot.status = "disputed";
            write.metadata.disputedBy = principal.actorType;
            break;
          case "confirm":
            write.snapshot.status = "active";
            write.snapshot.reviewAt = null;
            write.metadata.acceptance = ownerKnowledgeAcceptance(principal, snapshot.sources, at);
            write.metadata.disputedBy = null;
            write.record = { ...write.record, ownerHeld: true, lastConfirmedAt: at };
            break;
          case "archive":
            if (snapshot.status === "proposed")
              throw new AppError("conflict", "Resolve this proposal instead of archiving it.");
            write.snapshot.status = "archived";
            break;
          case "unarchive":
            if (snapshot.status !== "archived")
              throw new AppError("conflict", "Only archived memory can be unarchived.");
            write.snapshot.status = metadata.disputedBy ? "disputed" : "active";
            break;
          case "supersede": {
            // Disclose first: a replacement hidden from this caller is not found, never a cycle.
            // Locked, since proposing it writes a new revision of the replacement.
            const replacement = await ownedKnowledgeRevision(
              tx,
              principal,
              input.replacementId,
              true,
            );
            await access.disclose(tx, principal, replacement);
            await validateSupersession(tx, principal, snapshot.id, input.replacementId);
            if (agent && heldByOwner(current)) {
              write = await proposeReplacement(tx, principal, current, replacement);
              break;
            }
            write.snapshot.status = "superseded";
            write.metadata.supersededBy = input.replacementId;
            break;
          }
          case "restrict":
            if (snapshot.scope.workspace && snapshot.scope.workspace !== input.workspace)
              throw new AppError(
                "forbidden",
                "Restricting can only narrow memory; the account owner can widen it.",
              );
            rescope(write, current, input.workspace);
            break;
          case "widen":
            // A narrower source keeps narrowing this record at read time (effective disclosure).
            rescope(write, current, input.workspace);
            break;
          case "raise_sensitivity":
            write.snapshot.sensitivity = "sensitive";
            break;
          case "set_sensitivity":
            write.snapshot.sensitivity = input.sensitivity;
            break;
          case "set_access":
            write.record = { ...write.record, agentAccess: input.agentAccess };
            break;
          case "resolve_conflict": {
            const originalIds =
              snapshot.status === "proposed"
                ? (await linkedProposalIds(tx, principal.userId, current)).sort()
                : [];
            const [kept] = originalIds;
            if (!kept)
              throw new AppError("conflict", "This memory is not a pending proposal to resolve.");
            // Resolved, the proposal no longer derives from the record it proposed to change:
            // accepted it stands alone, linked by supersession; rejected it is superseded.
            write.derivations = write.derivations.filter(
              (edge) => edge.kind !== "revision_proposal",
            );
            write.metadata.inheritedRecordIds = write.metadata.inheritedRecordIds.filter(
              (id) => !originalIds.includes(id.toLowerCase()),
            );
            if (input.keep === "proposed") {
              related = await acceptProposal(tx, principal, current, originalIds, write, at);
            } else {
              // The person kept their memory, so the proposal is retired, never activated.
              write.snapshot.status = "superseded";
              write.metadata.supersededBy = kept;
            }
            break;
          }
        }
        if (!current.hasSidecar)
          await saveKnowledgeSidecar(tx, principal.userId, current, derivations);
        await writeKnowledgeRevision(tx, principal, write, at);
        const receipt = await writeKnowledgeReceipt(
          tx,
          principal,
          { ...input, action: input.action, requestHash },
          write.snapshot,
        );
        for (const other of related) {
          await writeKnowledgeRevision(tx, principal, other, at);
          await writeKnowledgeAudit(tx, principal, input, other.snapshot, receipt.id);
        }
        const result = await presentKnowledgeReceipt(tx, access, principal, receipt);
        await bumpKnowledgeEpoch(tx, principal.userId);
        return result;
      });
    },
  };
}
