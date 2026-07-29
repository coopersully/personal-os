import { createHash } from "node:crypto";
import { ConnectorError } from "@personal-os/connectors";
import { type Database, mailRuleWorkItems, type mailThreads } from "@personal-os/database";
import type { MailRuleAction, MailRuleProviderEffect } from "@personal-os/domain";
import { mailRuleActionNeedsDurableExecution } from "@personal-os/domain";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type MailThreadRow = typeof mailThreads.$inferSelect;

export type DurableMailRuleAuthorization = {
  profileId: string;
  profileVersion: number;
  ruleId: string;
  ruleVersion: number;
  userId: string;
};

export function durableMailRuleActionFingerprint(action: MailRuleAction): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        afterDays: action.afterDays,
        mailboxId: action.mailboxId,
        type: action.type,
      }),
    )
    .digest("hex");
}

export function classifyMailRuleProviderFailure(error: unknown): {
  code: string;
  disposition: "failed" | "reconcile" | "retry";
  effect: MailRuleProviderEffect;
  message: string;
} {
  if (error instanceof ConnectorError) {
    if (error.status === 429) {
      return {
        code: "provider_rate_limited",
        disposition: "retry",
        effect: "rejected",
        message: "The Mail provider rate-limited this bounded work item.",
      };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        code: "provider_authorization_failed",
        disposition: "retry",
        effect: "rejected",
        message:
          "The Mail provider no longer authorizes this operation; reconnect the account before the next retry.",
      };
    }
    if (error.status < 500 && error.status !== 408) {
      return {
        code: error.status === 404 ? "provider_source_missing" : "provider_rejected",
        disposition: "failed",
        effect: "rejected",
        message:
          error.status === 404
            ? "The Mail provider no longer has this conversation."
            : "The Mail provider rejected this operation.",
      };
    }
  }
  return {
    code: "provider_effect_indeterminate",
    disposition: "reconcile",
    effect: "indeterminate",
    message:
      "The Mail provider did not confirm whether the requested change completed; exact reconciliation is required.",
  };
}

export function strongestMailRuleProviderEffect(
  effects: MailRuleProviderEffect[],
  fallback: MailRuleProviderEffect,
): MailRuleProviderEffect {
  if (effects.includes("applied")) return "applied";
  if (effects.includes("indeterminate")) return "indeterminate";
  if (effects.includes("rejected")) return "rejected";
  return fallback;
}

export async function enqueueDurableMailRuleWork(
  transaction: DatabaseTransaction,
  input: DurableMailRuleAuthorization & {
    actions: MailRuleAction[];
    threads: MailThreadRow[];
  },
): Promise<number> {
  const actions = input.actions.filter(mailRuleActionNeedsDurableExecution);
  if (actions.length === 0 || input.threads.length === 0) return 0;
  const values = input.threads.flatMap((thread) =>
    actions.map((action) => {
      const dueAt = new Date(thread.receivedAt.getTime() + action.afterDays * 86_400_000);
      return {
        accountId: thread.accountId,
        action,
        actionFingerprint: durableMailRuleActionFingerprint(action),
        dueAt,
        nextAttemptAt: dueAt,
        profileId: input.profileId,
        profileVersion: input.profileVersion,
        remoteThreadId: thread.remoteThreadId,
        ruleId: input.ruleId,
        ruleVersion: input.ruleVersion,
        sourceUpdatedAt: thread.updatedAt,
        threadId: thread.id,
        userId: input.userId,
      };
    }),
  );
  const inserted = await transaction
    .insert(mailRuleWorkItems)
    .values(values)
    .onConflictDoNothing({
      target: [
        mailRuleWorkItems.accountId,
        mailRuleWorkItems.remoteThreadId,
        mailRuleWorkItems.ruleId,
        mailRuleWorkItems.ruleVersion,
        mailRuleWorkItems.profileVersion,
        mailRuleWorkItems.actionFingerprint,
      ],
    })
    .returning({ id: mailRuleWorkItems.id });
  return inserted.length;
}

export function mailRuleActionIsApplied(
  action: MailRuleAction,
  state: { mailboxIds: string[]; starred: boolean; unread: boolean },
  remoteMailboxId: string | null,
): boolean {
  if (action.type === "archive") return !state.mailboxIds.includes("INBOX");
  if (action.type === "trash") return state.mailboxIds.includes("TRASH");
  if (action.type === "mark_read") return !state.unread;
  if (action.type === "star") return state.starred;
  return remoteMailboxId !== null && state.mailboxIds.includes(remoteMailboxId);
}

export function applyMailRuleActionToState(
  action: MailRuleAction,
  state: { mailboxIds: string[]; starred: boolean; unread: boolean },
  remoteMailboxId: string | null,
): { mailboxIds: string[]; starred: boolean; unread: boolean } {
  const mailboxIds = new Set(state.mailboxIds);
  let starred = state.starred;
  let unread = state.unread;
  if (action.type === "archive") mailboxIds.delete("INBOX");
  if (action.type === "trash") {
    mailboxIds.delete("INBOX");
    mailboxIds.add("TRASH");
  }
  if (action.type === "mark_read") {
    mailboxIds.delete("UNREAD");
    unread = false;
  }
  if (action.type === "star") {
    mailboxIds.add("STARRED");
    starred = true;
  }
  if (action.type === "add_label" && remoteMailboxId) mailboxIds.add(remoteMailboxId);
  return { mailboxIds: [...mailboxIds], starred, unread };
}
