import { createHash } from "node:crypto";
import {
  type Calendar,
  type CalendarCommitmentProposal,
  calendarProfilePreferencesSchema,
  type ParsedPreviewCalendarCommitmentInput,
} from "@personal-os/domain";

type CalendarProposalProfile = {
  preferences: Record<string, boolean | number | string | string[]>;
  status: "active" | "draft";
  version: number;
};

type CalendarProposalContext = {
  destination: Calendar;
  possibleDuplicateEventId: string | null;
  profile: CalendarProposalProfile | null;
};

/** Evaluate a caller-supplied Calendar candidate without treating its evidence as authority. */
export function buildCalendarCommitmentProposal(
  input: ParsedPreviewCalendarCommitmentInput,
  context: CalendarProposalContext,
): CalendarCommitmentProposal {
  const { destination, possibleDuplicateEventId, profile } = context;
  const preferences = profile
    ? calendarProfilePreferencesSchema.safeParse(profile.preferences)
    : null;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const source = input.candidate.evidence.source;
  const eligibleEvidenceShape =
    input.candidate.evidence.kind !== "other" &&
    (source.provider === "local" || (source.accountId !== null && source.remoteId !== null));
  const providerProjectionReady =
    destination.provider === "local" ||
    (destination.source?.syncStatus === "idle" && destination.lastSyncedAt !== null);

  if (!destination.isWritable) reasons.push("The destination calendar is read-only.");
  if (destination.source?.syncStatus === "error")
    reasons.push("The destination source is in an error state and must be repaired first.");
  if (
    input.requestedPolicy === "approved_rule" &&
    destination.provider !== "local" &&
    !providerProjectionReady
  )
    reasons.push(
      "Rule-authorized creation requires an idle destination with a completed Calendar sync.",
    );
  if (possibleDuplicateEventId)
    warnings.push(
      "An event has the same destination, title, start, and end. This is only a possible duplicate, not a durable source identity.",
    );
  if (input.requestedPolicy === "approved_rule" && !eligibleEvidenceShape)
    reasons.push(
      "The candidate does not have an eligible evidence shape, and caller-supplied evidence is never authority.",
    );
  if (input.requestedPolicy === "approved_rule" && input.candidate.flexibility !== "hard")
    reasons.push("Flexible commitments remain proposals and cannot be created automatically.");
  if (
    profile &&
    input.expectedProfileVersion !== null &&
    input.expectedProfileVersion !== profile.version
  )
    reasons.push("The Calendar profile version changed; preview the candidate again.");
  if (!profile && input.expectedProfileVersion !== null)
    reasons.push("The expected Calendar profile does not exist; refresh setup before continuing.");
  if (input.requestedPolicy === "approved_rule")
    reasons.push(
      "Caller-supplied evidence is not authority. Rule-authorized apply requires a future durable, server-verified intake record.",
    );
  if (input.requestedPolicy === "approve_each")
    reasons.push(
      "This intake contract is preview-only; a person must create the event through an interactive Calendar action.",
    );
  if (input.requestedPolicy === "preview")
    reasons.push(
      "This preview does not authorize a write; a person must use an interactive Calendar action to create the event.",
    );
  if (profile?.status === "active" && preferences?.success) {
    if (
      input.candidate.evidence.kind === "other" ||
      !preferences.data.automaticEventEvidence.includes(input.candidate.evidence.kind)
    )
      warnings.push("The active Calendar profile does not list this evidence kind.");
    if (preferences.data.defaultCalendarId !== destination.id)
      warnings.push("The candidate does not use the profile's default destination.");
  }
  if (destination.provider !== "local")
    warnings.push(
      "Creating this candidate through an interactive Calendar action would write to the connected provider before Ilo commits its projection.",
    );
  if (destination.provider !== "local" && !providerProjectionReady)
    warnings.push(
      "The connected destination is not fully fresh; exact duplicate detection may be incomplete.",
    );
  if (input.candidate.buffer.beforeMinutes > 0 || input.candidate.buffer.afterMinutes > 0)
    warnings.push(
      "Buffer preferences are preserved in the proposal but do not create or move other events.",
    );
  warnings.push(
    "This bounded proposal cannot add attendees, send invitations, create recurrence, or rearrange another event.",
  );

  const effectivePolicy = input.requestedPolicy === "read_only" ? "read_only" : "preview";
  return {
    authority: "caller_supplied_unverified",
    candidate: input.candidate,
    destination,
    fingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    policy: {
      canApply: false,
      effectivePolicy,
      reasons,
      requestedPolicy: input.requestedPolicy,
      requiresInteractiveApproval: effectivePolicy === "preview",
    },
    possibleDuplicateEventId,
    providerEffect: destination.provider === "local" ? "local_write" : "provider_write",
    warnings,
  };
}
