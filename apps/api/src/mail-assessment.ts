import { createHash } from "node:crypto";
import type {
  MailDispositionKind,
  MailHealthDimension,
  MailObligationKind,
  MailObligationState,
  MaterialSourceReference,
} from "@personal-os/domain";
import type { MailPlaybook } from "./mail-playbook.js";

export type MailAssessmentMessageSnapshot = {
  authority: "provider_projected" | "local";
  direction: "inbound" | "outbound";
  id: string;
  observedAt: string;
  revision: string | null;
};

export type MailAssessmentObligationSnapshot = {
  id: string;
  kind: MailObligationKind;
  sourceThreadRevision: string;
  state: MailObligationState;
  version: number;
};

export type MailAssessmentThreadSnapshot = {
  accountId: string;
  approvedRuleMatched: boolean;
  approvedRuleMatches?: Array<{ ruleId: string; ruleVersion: number }>;
  attentionLinked: boolean;
  currentDisposition: {
    disposition: MailDispositionKind;
    sourceThreadRevision: string;
  } | null;
  goalLinked: boolean;
  id: string;
  messages: MailAssessmentMessageSnapshot[];
  obligations: MailAssessmentObligationSnapshot[];
  snoozedUntil: string | null;
  source: MaterialSourceReference;
  starred: boolean;
  updatedAt: string;
};

export type MailAssessmentSnapshot = {
  effectCounts: { failed: number; pending: number; reconcile: number };
  now: string;
  profileVersion: number | null;
  rulebookVersion: string;
  sourceFreshness: "current" | "stale" | "partial" | "unavailable";
  threads: MailAssessmentThreadSnapshot[];
};

export type MailAssessment = {
  blockers: string[];
  dispositionCounts: Record<MailDispositionKind, number>;
  dispositionTransitions: Array<{
    disposition: MailDispositionKind;
    reasonCode: "active_ilo_snooze";
    sourceThreadRevision: string;
    threadId: string;
  }>;
  health: MailHealthDimension[];
  ledgerFingerprint: string;
  obligationCounts: Record<MailObligationState, number>;
  obligationTransitions: Array<{
    evidence: MaterialSourceReference[];
    expectedVersion: number;
    nextState: "resolved";
    obligationId: string;
    reasonCode: "newer_outbound_observed";
    threadId: string;
  }>;
  proposedSettlement: "maintained" | "maintained_with_questions" | "blocked";
  questions: Array<{
    accountId: string;
    evidence: MaterialSourceReference[];
    fingerprint: string;
    kind: "needs_disposition";
    options: Array<{ label: string; value: string }>;
    reason: string;
    threadId: string;
  }>;
  ruleWorkIntentions: Array<{ ruleId: string; ruleVersion: number; threadId: string }>;
};

const obligationStates: MailObligationState[] = [
  "open",
  "waiting",
  "deferred",
  "resolved",
  "dismissed",
];
const dispositionKinds: MailDispositionKind[] = [
  "active",
  "deferred",
  "waiting",
  "delegated",
  "reference",
  "noise",
  "resolved",
];

function zeroRecord<Key extends string>(keys: Key[]): Record<Key, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<Key, number>;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assessmentIdentity(snapshot: MailAssessmentSnapshot, playbook: MailPlaybook) {
  return {
    playbookVersion: playbook.version,
    profileVersion: snapshot.profileVersion,
    rulebookVersion: snapshot.rulebookVersion,
    sourceFreshness: snapshot.sourceFreshness,
    threads: [...snapshot.threads]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((thread) => ({
        approvedRuleMatches: [...(thread.approvedRuleMatches ?? [])].sort((left, right) =>
          left.ruleId.localeCompare(right.ruleId),
        ),
        currentDisposition: thread.currentDisposition,
        id: thread.id,
        messages: [...thread.messages]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map(({ authority, direction, id, observedAt, revision }) => ({
            authority,
            direction,
            id,
            observedAt,
            revision,
          })),
        obligations: [...thread.obligations]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map(({ id, kind, sourceThreadRevision, state, version }) => ({
            id,
            kind,
            sourceThreadRevision,
            state,
            version,
          })),
        snoozedUntil: thread.snoozedUntil,
        source: thread.source,
        updatedAt: thread.updatedAt,
      })),
  };
}

export function assessMail(
  snapshot: MailAssessmentSnapshot,
  playbook: MailPlaybook,
): MailAssessment {
  const obligationTransitions: MailAssessment["obligationTransitions"] = [];
  const dispositionTransitions: MailAssessment["dispositionTransitions"] = [];
  const questions: MailAssessment["questions"] = [];
  const ruleWorkIntentions: MailAssessment["ruleWorkIntentions"] = [];
  const obligationCounts = zeroRecord(obligationStates);
  const dispositionCounts = zeroRecord(dispositionKinds);
  const now = new Date(snapshot.now).getTime();

  for (const thread of snapshot.threads) {
    if (thread.currentDisposition) {
      dispositionCounts[thread.currentDisposition.disposition] += 1;
    }
    for (const obligation of thread.obligations) {
      obligationCounts[obligation.state] += 1;
      if (obligation.kind !== "reply" || obligation.state === "resolved") continue;
      const newerOutbound = thread.messages.some(
        (message) =>
          message.authority === "provider_projected" &&
          message.direction === "outbound" &&
          new Date(message.observedAt).getTime() >
            new Date(obligation.sourceThreadRevision).getTime(),
      );
      if (newerOutbound) {
        obligationTransitions.push({
          evidence: [thread.source],
          expectedVersion: obligation.version,
          nextState: "resolved",
          obligationId: obligation.id,
          reasonCode: "newer_outbound_observed",
          threadId: thread.id,
        });
        obligationCounts[obligation.state] -= 1;
        obligationCounts.resolved += 1;
      }
    }

    if (
      thread.snoozedUntil &&
      new Date(thread.snoozedUntil).getTime() > now &&
      thread.currentDisposition?.disposition !== "deferred"
    ) {
      dispositionTransitions.push({
        disposition: "deferred",
        reasonCode: "active_ilo_snooze",
        sourceThreadRevision: thread.updatedAt,
        threadId: thread.id,
      });
    }

    const surfaced =
      thread.starred ||
      thread.attentionLinked ||
      thread.goalLinked ||
      thread.approvedRuleMatched ||
      (thread.approvedRuleMatches?.length ?? 0) > 0;
    if (snapshot.sourceFreshness === "current" && surfaced && !thread.currentDisposition) {
      questions.push({
        accountId: thread.accountId,
        evidence: [thread.source],
        fingerprint: fingerprint({
          dedupeVersion: playbook.questionPolicy.dedupeVersion,
          kind: "needs_disposition",
          sourceRevision: thread.source.revision,
          threadId: thread.id,
        }),
        kind: "needs_disposition",
        options: dispositionKinds.map((value) => ({
          label: value.replaceAll("_", " "),
          value,
        })),
        reason:
          "This surfaced thread has no recorded disposition. Choose how Ilo should steward it.",
        threadId: thread.id,
      });
    }
    for (const match of thread.approvedRuleMatches ?? []) {
      ruleWorkIntentions.push({ ...match, threadId: thread.id });
    }
  }

  const blockers: string[] = [];
  if (snapshot.sourceFreshness !== "current") {
    blockers.push(`source_evidence_${snapshot.sourceFreshness}`);
  }
  if (snapshot.effectCounts.failed > 0) blockers.push("provider_effect_failed");
  if (snapshot.effectCounts.reconcile > 0) blockers.push("provider_effect_reconcile");

  const proposedSettlement =
    blockers.length > 0
      ? "blocked"
      : questions.length > 0 || snapshot.effectCounts.pending > 0
        ? "maintained_with_questions"
        : "maintained";
  const sourceSignal =
    snapshot.sourceFreshness === "current"
      ? "healthy"
      : snapshot.sourceFreshness === "unavailable"
        ? "unknown"
        : "strained";
  const health: MailHealthDimension[] = [
    {
      dimension: "source_trust",
      evidenceIds: snapshot.threads.map((thread) => thread.id),
      signal: sourceSignal,
      summary:
        snapshot.sourceFreshness === "current"
          ? "Connected Mail evidence is current for this assessment."
          : `Connected Mail evidence is ${snapshot.sourceFreshness}; clean settlement is unavailable.`,
    },
    {
      dimension: "obligation_integrity",
      evidenceIds: snapshot.threads.flatMap((thread) =>
        thread.obligations.map((obligation) => obligation.id),
      ),
      signal: "healthy",
      summary: "Only explicit, previously recorded obligations were evaluated.",
    },
    {
      dimension: "ambiguity",
      evidenceIds: questions.map((question) => question.threadId),
      signal: questions.length > 0 ? "attention" : "healthy",
      summary:
        questions.length > 0
          ? `${questions.length} material disposition question(s) need user judgment.`
          : "No material disposition ambiguity was found.",
    },
    {
      dimension: "provider_effects",
      evidenceIds: [],
      signal:
        snapshot.effectCounts.failed > 0 || snapshot.effectCounts.reconcile > 0
          ? "strained"
          : snapshot.effectCounts.pending > 0
            ? "attention"
            : "healthy",
      summary: "Provider effects are reported from durable work state, never assumed from intent.",
    },
    {
      dimension: "rule_quality",
      evidenceIds: ruleWorkIntentions.map((intention) => intention.ruleId),
      signal: "healthy",
      summary: "Only exact enabled rule matches were emitted as work intentions.",
    },
  ];

  return {
    blockers,
    dispositionCounts,
    dispositionTransitions,
    health,
    ledgerFingerprint: fingerprint(assessmentIdentity(snapshot, playbook)),
    obligationCounts,
    obligationTransitions,
    proposedSettlement,
    questions,
    ruleWorkIntentions,
  };
}
