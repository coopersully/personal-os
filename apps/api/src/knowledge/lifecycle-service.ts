import type { Database } from "@personal-os/database";
import {
  type KnowledgeLifecycleInput,
  type KnowledgeMutationResult,
  knowledgeClaimContent,
  knowledgeClaimKey,
  knowledgeClaimValue,
  knowledgeLifecycleInputSchema,
} from "@personal-os/domain";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import {
  bumpKnowledgeEpoch,
  createKnowledgeAccess,
  type KnowledgeTransaction,
  knowledgeRevisionDerivations,
  ownedKnowledgeRevision,
  preserveKnowledgeDisclosure,
  requireKnowledgeOwner,
} from "./access.js";
import { admitKnowledgeClaim } from "./forget-suppression.js";
import {
  findKnowledgeReceipt,
  knowledgeRequestHash,
  knowledgeWriteScopes,
  ownerKnowledgeAcceptance,
  prepareKnowledgeRevision,
  presentKnowledgeReceipt,
  saveKnowledgeSidecar,
  writeKnowledgeReceipt,
  writeKnowledgeRevision,
} from "./record-service.js";

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

export function createKnowledgeLifecycleService({
  db,
  now,
  suppressionKey,
}: {
  db: Database;
  now: () => Date;
  suppressionKey?: Uint8Array;
}) {
  const access = createKnowledgeAccess(now);
  return {
    async mutate(
      principal: Principal,
      raw: KnowledgeLifecycleInput,
    ): Promise<KnowledgeMutationResult> {
      const input = knowledgeLifecycleInputSchema.parse(raw);
      if (input.action === "confirm" || input.action === "restrict")
        requireKnowledgeOwner(principal);
      const requestHash = knowledgeRequestHash(principal, input);
      return db.transaction(async (tx) => {
        await access.admit(tx, principal, knowledgeWriteScopes);
        const prior = await findKnowledgeReceipt(
          tx,
          principal,
          input.mutationKey,
          requestHash,
          suppressionKey,
        );
        if (prior) return presentKnowledgeReceipt(tx, access, principal, prior);

        const current = await ownedKnowledgeRevision(tx, principal, input.recordId, true);
        const { snapshot, metadata } = current;
        const purpose = snapshot.purposes[0];
        if (!purpose)
          throw new AppError("forbidden", "The knowledge record has no permitted purpose.");
        for (const currentPurpose of snapshot.purposes)
          await access.disclose(tx, principal, current, currentPurpose);
        if (snapshot.revision !== input.expectedRevision)
          throw new AppError("conflict", "The knowledge revision changed.", {
            current: await access.present(tx, principal, current, purpose),
          });
        if (snapshot.status === "superseded")
          throw new AppError("conflict", "Superseded knowledge can only be inspected.");
        if (
          principal.actorType === "agent" &&
          metadata.disputedBy === "user" &&
          input.action !== "revise"
        )
          throw new AppError("forbidden", "The account owner must resolve this dispute.");

        const at = now();
        const derivations = await knowledgeRevisionDerivations(tx, principal.userId, current);
        let write: Parameters<typeof writeKnowledgeRevision>[2] = {
          snapshot: { ...snapshot, revision: snapshot.revision + 1 },
          metadata: { ...metadata },
          claimKey: current.claimKey,
          derivations,
          newSources: [],
        };
        switch (input.action) {
          case "revise":
            write = await prepareKnowledgeRevision({
              tx,
              access,
              principal,
              at,
              current,
              replaceEvidence: input.evidence !== undefined,
              asProposal:
                principal.actorType === "agent" &&
                (metadata.acceptance?.kind === "owner" || metadata.disputedBy === "user"),
              input: {
                mutationKey: input.mutationKey,
                content: input.content,
                scope: snapshot.scope,
                sensitivity: snapshot.sensitivity,
                purposes: snapshot.purposes,
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
            break;
          case "supersede": {
            if (principal.actorType === "agent" && metadata.acceptance?.kind === "owner")
              throw new AppError(
                "forbidden",
                "The account owner must supersede accepted knowledge.",
              );
            await validateSupersession(tx, principal, snapshot.id, input.replacementId);
            const replacement = await ownedKnowledgeRevision(tx, principal, input.replacementId);
            for (const currentPurpose of snapshot.purposes)
              await access.disclose(tx, principal, replacement, currentPurpose);
            write.snapshot.status = "superseded";
            write.metadata.supersededBy = input.replacementId;
            break;
          }
          case "restrict": {
            const { scope, purposes, sensitivity } = input.restrictions;
            const restricted = {
              ...snapshot,
              scope: scope ?? snapshot.scope,
              purposes: purposes ?? snapshot.purposes,
              sensitivity: sensitivity ?? snapshot.sensitivity,
              revision: snapshot.revision + 1,
            };
            preserveKnowledgeDisclosure(restricted, snapshot);
            write.snapshot = restricted;
            write.claimKey = knowledgeClaimKey(
              restricted.scope.workspace,
              knowledgeClaimContent(snapshot, metadata.generatedInference),
            );
            break;
          }
        }
        let contentChanged = false;
        if (input.action === "revise") {
          const previous = knowledgeClaimContent(snapshot, metadata.generatedInference);
          if (principal.actorType === "agent") {
            // Claim values omit decision reasons. Agent writes also need to
            // recheck suppression when they replace source evidence.
            contentChanged =
              JSON.stringify(input.content) !== JSON.stringify(previous) ||
              (input.evidence !== undefined &&
                JSON.stringify(input.evidence) !==
                  JSON.stringify(snapshot.sources.map((source) => source.evidence)));
          } else {
            contentChanged =
              JSON.stringify(knowledgeClaimValue(input.content)) !==
              JSON.stringify(knowledgeClaimValue(previous));
          }
        }
        if (
          (input.action === "revise" || input.action === "restrict") &&
          (write.snapshot.id !== snapshot.id ||
            write.claimKey !== current.claimKey ||
            contentChanged)
        )
          await admitKnowledgeClaim(tx, {
            principal,
            claimKey: write.claimKey,
            key: suppressionKey,
            explicitReadd:
              input.action === "revise" &&
              principal.actorType === "user" &&
              write.metadata.origin === "stated",
            at,
          });
        if (!current.hasSidecar)
          await saveKnowledgeSidecar(tx, principal.userId, current, derivations);
        await writeKnowledgeRevision(tx, principal, write, at);
        const receipt = await writeKnowledgeReceipt(
          tx,
          principal,
          { ...input, action: input.action, requestHash },
          write.snapshot,
        );
        const result = await presentKnowledgeReceipt(tx, access, principal, receipt);
        await bumpKnowledgeEpoch(tx, principal.userId);
        return result;
      });
    },
  };
}
