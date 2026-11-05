import type {
  FinanceConversationBatch,
  FinanceHumanWorkRef,
  MaintenanceScope,
  RepairContextHeldReason,
} from "@personal-os/domain";
import type { Principal } from "../types.js";
import type { FinanceTransaction } from "./context.js";

/**
 * Future, server-private contracts only. No implementation, admission constructor, runtime
 * capability, repository or port registration is supplied by this module. Parsing/copying a
 * snapshot never grants permission. Existing question/approval and Finance-prefix paths remain
 * separate from per-child repair context capture.
 */
export type RepairWork = Readonly<FinanceHumanWorkRef & { kind: "repair" }>;
export type RepairContextClock = () => Date;
export type RepairNotificationMembership = Readonly<{
  userId: string;
  attemptId: string;
  intentId: string;
}>; // actual composite key; no attempt-item UUID
export type RepairOriginalSource = Readonly<{
  ownerId: string;
  sourceWork: RepairWork;
  originalRunId: string;
  scope: MaintenanceScope;
  originalBatch: FinanceConversationBatch & {
    automationScheduleId: string;
    authorizationConnectionId: string;
  };
  notificationMembership: RepairNotificationMembership;
  outboundMessageId: string;
}>; // data snapshot only, never authority; reload native records/semantic derivation
export type RepairReplyCommand = Readonly<{
  operationId: string;
  work: RepairWork;
  inboundMessageId: string;
  replyBindingId: string;
  text: string;
}>;
export type RepairCaptureReceipt = Readonly<{
  ownerId: string;
  childOperationId: string;
  replyBindingId: string;
  inboundClaimId: string;
  inboundMessageId: string;
  textingConnectionId: string;
  consentEpoch: number;
  requestHash: string;
  source: RepairOriginalSource;
  contextId: string;
  contextRevision: string;
  canonicalMessageId: string;
  canonicalMessageSequence: string;
  capturedAt: string;
  expiresAt: string;
}>;
export type RepairCaptureInspection =
  | { state: "absent" }
  | { state: "captured"; receipt: RepairCaptureReceipt; routeId: string }
  | { state: "uncertain"; reason: "receipt_inspection_failed" | "incomplete_receipt" };
/** Capture receipt is immutable history. Inspect the mutable route separately on every replay. */
export type RepairCaptureOutcome =
  | { state: "captured"; receipt: RepairCaptureReceipt; routeId: string }
  | { state: "waiting" | "blocked" | "uncertain"; reason: string };
export type RepairRouteInspection =
  | { state: "awaiting_host"; routeId: string; routeRevision: string }
  | {
      state: "reserved" | "body_released" | "acknowledged";
      routeId: string;
      routeRevision: string;
      receivingRunId: string;
    }
  | {
      state: "held" | "expired" | "uncertain";
      routeId: string;
      routeRevision: string;
      reason: RepairContextHeldReason;
    };
// No consumed variant: this cut supplies no causal-reply guard implementation.
/**
 * Inspect the exact child receipt/request hash before new effects; a failed inspection is never
 * absence. The future verifier must load current native claim/outbound/connection/consent/source
 * rows, then invoke capture in this SAME owner-locked transaction. Child CAS, receipt, context,
 * canonical message and route commit together; a throw rolls all of them back.
 *
 * The callback snapshot is data, not a transferable admission. If implementation passes a
 * verified object across internal seams, enforce instance + exact tx + owner + child operation /
 * request-hash identity and single use with private runtime state, such as a private WeakMap.
 * No public constructor, JSON flag, exported mint or TypeScript shape substitutes for that check.
 * Texting connection/epoch is distinct from the original host authorization connection.
 */
export interface RepairReplyCapturePort {
  inspectCapture(
    tx: FinanceTransaction,
    ownerId: string,
    command: RepairReplyCommand,
  ): Promise<RepairCaptureInspection>;
  inspectRoute(
    tx: FinanceTransaction,
    ownerId: string,
    routeId: string,
    principal: Principal,
    clock: RepairContextClock,
  ): Promise<RepairRouteInspection>;
  withVerifiedRepairReply(
    tx: FinanceTransaction,
    ownerId: string,
    command: RepairReplyCommand,
    clock: RepairContextClock,
    capture: (source: RepairOriginalSource) => Promise<RepairCaptureOutcome>,
  ): Promise<RepairCaptureOutcome>;
}
export type RepairSuccessorInput = Readonly<{
  ownerId: string;
  principal: Principal;
  routeId: string;
  expectedRouteRevision: string;
  candidateRunId: string;
}>;
export type RepairReservationPrecondition = Readonly<{
  ownerId: string;
  routeId: string;
  routeRevision: string;
  childOperationId: string;
  canonicalMessageId: string;
  contextId: string;
  contextRevision: string;
  originalRunId: string;
  originalBatchRunId: string;
  targetScheduleId: string;
  targetAuthorizationConnectionId: string;
  receivingRunId: string;
  candidateCutoffSequence: string;
  sourceWork: RepairWork;
  checkedAt: string;
  expiresAt: string;
}>; // transaction-bound expected values, not permission or a persisted grant
export type RepairSourceDisposition =
  | { state: "same_frozen_action" }
  | { state: "resolved" | "changed" | "unavailable"; reason: string };
export type RepairSuccessorOutcome =
  | { state: "eligible"; precondition: RepairReservationPrecondition }
  | { state: "same_reserved_run"; precondition: RepairReservationPrecondition }
  | { state: "waiting" | "held" | "expired" | "uncertain"; reason: string };
/**
 * Load owner-joined immutable capture receipt, frozen original batch and their native references;
 * recompute existing Finance semantic action/episode, never compare only supplied JSON/hashes.
 * Original and candidate host tuples must both be nonnull. Keep global work/notification
 * currentness unchanged. Only the exact tentative/recorded successor may be excluded from this
 * route's newer-run comparison, and only inside the successful route CAS + membership + NEW
 * fixed-batch transaction. At most one successor, possibly none, is designated; unrelated newer
 * work can hold the route. Never expose a designation in a separate commit.
 *
 * Recheck actual principal/host authority, consent, fresh clock/deadline, source/context revision
 * and disposition even for same_reserved_run. Check message sequence AFTER original cutoff and
 * THROUGH new cutoff. Failed committed reservations remain held on that run: no transfer,
 * membership deletion, old-batch extension, forced run, timer or general wake.
 *
 * A committed body release is not proof of host receipt/read; ack is a separate observation.
 * New causal references need a separately reserved live repair-route guard. Until then these
 * contracts withhold consumed assertions and confer no financial authority.
 */
export interface RepairSuccessorPort {
  inspectCapturedSource(
    tx: FinanceTransaction,
    input: RepairSuccessorInput,
    clock: RepairContextClock,
  ): Promise<RepairSourceDisposition>;
  inspectSuccessor(
    tx: FinanceTransaction,
    input: RepairSuccessorInput,
    clock: RepairContextClock,
  ): Promise<RepairSuccessorOutcome>;
}
