import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  mailCalendarCommitmentIntakes,
  mailMessages,
  type mailThreads,
} from "@personal-os/database";
import {
  calendarAttachmentProjectionOverflow,
  MAX_MAIL_CALENDAR_PARTS_PER_MESSAGE,
  type MailAttachment,
} from "@personal-os/domain";
import { and, eq, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type MailMessageRow = typeof mailMessages.$inferSelect;
type MailThreadRow = typeof mailThreads.$inferSelect;
type IntakePrincipal = {
  actorId: string;
  actorType: "agent" | "connector" | "system" | "user";
  userId: string;
};

const CALENDAR_ATTACHMENT_TYPES = new Set(["application/ics", "text/calendar", "text/x-vcalendar"]);

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function changedFieldNames(
  comparisons: Array<{ after: unknown; before: unknown; name: string }>,
): string[] {
  return comparisons
    .filter((comparison) => comparison.before !== comparison.after)
    .map((comparison) => comparison.name);
}

export function isCalendarCommitmentAttachment(attachment: MailAttachment): boolean {
  if (attachment.projectionIssue === "calendar_attachment_projection_overflow") return true;
  const [contentType = ""] = attachment.contentType.toLowerCase().split(";");
  return CALENDAR_ATTACHMENT_TYPES.has(contentType.trim());
}

export function calendarCommitmentAttachmentCandidates(
  attachments: readonly MailAttachment[],
  overflowPartId = "part:projection-overflow",
): MailAttachment[] {
  const projectedOverflow = attachments.find(
    (attachment) => attachment.projectionIssue === "calendar_attachment_projection_overflow",
  );
  if (projectedOverflow) return [calendarAttachmentProjectionOverflow(overflowPartId)];
  const candidates = attachments.filter(isCalendarCommitmentAttachment);
  return candidates.length > MAX_MAIL_CALENDAR_PARTS_PER_MESSAGE
    ? [calendarAttachmentProjectionOverflow(overflowPartId)]
    : candidates;
}

export function mailCommitmentSourceFingerprint(
  message: Pick<
    MailMessageRow,
    | "attachments"
    | "bodyText"
    | "cc"
    | "from"
    | "providerMailboxIds"
    | "providerRevision"
    | "receivedAt"
    | "remoteMessageId"
    | "to"
  >,
): string {
  return fingerprint({
    attachments: message.attachments,
    bodyText: message.bodyText,
    cc: message.cc,
    from: message.from,
    providerMailboxIds: message.providerMailboxIds,
    providerRevision: message.providerRevision,
    receivedAt: message.receivedAt.toISOString(),
    remoteMessageId: message.remoteMessageId,
    to: message.to,
  });
}

function safeAuditMetadata(
  intake: typeof mailCalendarCommitmentIntakes.$inferSelect | null,
): Record<string, unknown> | null {
  if (!intake) return null;
  return {
    accountIdHash: fingerprint(intake.accountId),
    authority: intake.authority,
    evidenceKind: intake.evidenceKind,
    id: intake.id,
    remoteMessageIdHash: fingerprint(intake.remoteMessageId),
    remotePartIdHash: fingerprint(intake.remotePartId),
    status: intake.status,
  };
}

export function mailCommitmentMessageLockKey(accountId: string, remoteMessageId: string): string {
  return fingerprint({ accountId, remoteMessageId });
}

async function writeIntakeAudit(
  transaction: DatabaseTransaction,
  input: {
    action: string;
    after: typeof mailCalendarCommitmentIntakes.$inferSelect;
    before: typeof mailCalendarCommitmentIntakes.$inferSelect | null;
    changedFields?: string[];
    principal: IntakePrincipal;
    requestId: string;
  },
): Promise<void> {
  await transaction.insert(auditEvents).values(
    auditValues({
      action: input.action,
      after: {
        ...safeAuditMetadata(input.after),
        ...(input.changedFields ? { changedFields: input.changedFields } : {}),
      },
      before: safeAuditMetadata(input.before),
      entityId: input.after.id,
      entityType: "mail_calendar_commitment_intake",
      principal: input.principal,
      requestId: input.requestId,
    }),
  );
}

export async function recordMailCalendarCommitmentIntakes(
  transaction: DatabaseTransaction,
  input: {
    accountId: string;
    providerAccountAddressHint: string | null;
    message: MailMessageRow;
    principal: IntakePrincipal;
    recordedAt: Date;
    requestId: string;
    thread: MailThreadRow;
  },
): Promise<number> {
  if (
    input.thread.userId !== input.principal.userId ||
    input.thread.accountId !== input.accountId ||
    input.message.threadId !== input.thread.id
  ) {
    throw new AppError(
      "forbidden",
      "Mail-to-Calendar intake requires one owned account, thread, and message topology.",
    );
  }
  const providerAccountAddressHintHash = input.providerAccountAddressHint
    ? fingerprint(input.providerAccountAddressHint.trim().toLowerCase())
    : null;
  const sourceFingerprint = mailCommitmentSourceFingerprint(input.message);
  const lockKey = mailCommitmentMessageLockKey(input.accountId, input.message.remoteMessageId);
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
  const existingRows = await transaction
    .select()
    .from(mailCalendarCommitmentIntakes)
    .where(
      and(
        eq(mailCalendarCommitmentIntakes.accountId, input.accountId),
        eq(mailCalendarCommitmentIntakes.remoteMessageId, input.message.remoteMessageId),
      ),
    )
    .for("update");
  const existingByPart = new Map(existingRows.map((intake) => [intake.remotePartId, intake]));
  const observedParts = new Set<string>();
  let recorded = 0;
  for (const attachment of calendarCommitmentAttachmentCandidates(
    input.message.attachments,
    `projection-overflow:${createHash("sha256")
      .update(input.message.remoteMessageId)
      .digest("hex")}`,
  )) {
    const remotePartId = attachment.providerPartId ?? attachment.id;
    observedParts.add(remotePartId);
    const attachmentFingerprint = fingerprint({
      contentType: attachment.contentType.toLowerCase(),
      filename: attachment.filename,
      providerAttachmentId: attachment.providerAttachmentId ?? null,
      remotePartId,
      size: attachment.size,
    });
    const idempotencyKey = fingerprint({
      accountId: input.accountId,
      remoteMessageId: input.message.remoteMessageId,
      remotePartId,
    });
    const existing = existingByPart.get(remotePartId);
    const sourceWasUnavailable = existing?.evidenceKind.startsWith("source_") === true;
    const sourceChanged =
      existing !== undefined &&
      (sourceWasUnavailable ||
        existing.sourceFingerprint !== sourceFingerprint ||
        existing.attachmentFingerprint !== attachmentFingerprint ||
        existing.providerAccountAddressHintHash !== providerAccountAddressHintHash);
    const projectionOverflow =
      attachment.projectionIssue === "calendar_attachment_projection_overflow";
    const values = {
      accountId: input.accountId,
      attachment,
      attachmentFingerprint,
      providerAccountAddressHintHash,
      authority:
        existing && !sourceChanged
          ? existing.authority
          : ("provider_projected_unverified" as const),
      evidenceKind:
        existing && !sourceChanged
          ? existing.evidenceKind
          : projectionOverflow
            ? "calendar_attachment_projection_overflow"
            : "calendar_attachment_metadata",
      idempotencyKey,
      remoteMessageId: input.message.remoteMessageId,
      remotePartId,
      remoteThreadId: input.thread.remoteThreadId,
      sourceFingerprint,
      sourceMessageMailboxIds: input.message.providerMailboxIds,
      sourceMessageRevision: input.message.providerRevision,
      sourceMessageId: input.message.id,
      sourceThreadId: input.thread.id,
      sourceThreadRevision:
        existing && !sourceChanged ? existing.sourceThreadRevision : input.thread.updatedAt,
      status: existing && !sourceChanged ? existing.status : ("preview_only" as const),
      userId: input.principal.userId,
    };
    const intake = requireDatabaseRecord(
      (existing
        ? await transaction
            .update(mailCalendarCommitmentIntakes)
            .set({ ...values, updatedAt: input.recordedAt })
            .where(eq(mailCalendarCommitmentIntakes.id, existing.id))
            .returning()
        : await transaction.insert(mailCalendarCommitmentIntakes).values(values).returning())[0],
      "The Mail-to-Calendar intake evidence could not be recorded.",
    );
    const changed =
      !existing ||
      existing.sourceFingerprint !== intake.sourceFingerprint ||
      existing.attachmentFingerprint !== intake.attachmentFingerprint ||
      existing.providerAccountAddressHintHash !== intake.providerAccountAddressHintHash ||
      existing.evidenceKind !== intake.evidenceKind ||
      existing.authority !== intake.authority ||
      existing.status !== intake.status;
    if (changed) {
      const changedFields = existing
        ? changedFieldNames([
            {
              after: intake.sourceFingerprint,
              before: existing.sourceFingerprint,
              name: "sourceFingerprint",
            },
            {
              after: intake.attachmentFingerprint,
              before: existing.attachmentFingerprint,
              name: "attachmentFingerprint",
            },
            {
              after: intake.providerAccountAddressHintHash,
              before: existing.providerAccountAddressHintHash,
              name: "providerAccountAddressHint",
            },
            { after: intake.evidenceKind, before: existing.evidenceKind, name: "evidenceKind" },
            { after: intake.authority, before: existing.authority, name: "authority" },
            { after: intake.status, before: existing.status, name: "status" },
          ])
        : ["intake"];
      await writeIntakeAudit(transaction, {
        action: existing ? "mail_calendar_intake.source_changed" : "mail_calendar_intake.recorded",
        after: intake,
        before: existing ?? null,
        changedFields,
        principal: input.principal,
        requestId: input.requestId,
      });
    }
    recorded += existing ? 0 : 1;
  }
  for (const existing of existingRows) {
    if (observedParts.has(existing.remotePartId)) continue;
    const changed =
      existing.authority !== "provider_projected_unverified" ||
      existing.status !== "preview_only" ||
      existing.evidenceKind !== "calendar_attachment_missing" ||
      existing.sourceFingerprint !== sourceFingerprint ||
      existing.providerAccountAddressHintHash !== providerAccountAddressHintHash;
    const intake = requireDatabaseRecord(
      (
        await transaction
          .update(mailCalendarCommitmentIntakes)
          .set({
            authority: "provider_projected_unverified",
            evidenceKind: "calendar_attachment_missing",
            providerAccountAddressHintHash,
            sourceFingerprint,
            sourceMessageId: input.message.id,
            sourceMessageMailboxIds: input.message.providerMailboxIds,
            sourceMessageRevision: input.message.providerRevision,
            sourceThreadId: input.thread.id,
            sourceThreadRevision: input.thread.updatedAt,
            status: "preview_only",
            updatedAt: input.recordedAt,
          })
          .where(eq(mailCalendarCommitmentIntakes.id, existing.id))
          .returning()
      )[0],
      "The missing Mail-to-Calendar intake evidence could not be reconciled.",
    );
    if (changed) {
      await writeIntakeAudit(transaction, {
        action: "mail_calendar_intake.source_unavailable",
        after: intake,
        before: existing,
        changedFields: changedFieldNames([
          {
            after: intake.sourceFingerprint,
            before: existing.sourceFingerprint,
            name: "sourceFingerprint",
          },
          {
            after: intake.providerAccountAddressHintHash,
            before: existing.providerAccountAddressHintHash,
            name: "providerAccountAddressHint",
          },
          { after: intake.authority, before: existing.authority, name: "authority" },
          { after: intake.status, before: existing.status, name: "status" },
          { after: intake.evidenceKind, before: existing.evidenceKind, name: "evidenceKind" },
        ]),
        principal: input.principal,
        requestId: input.requestId,
      });
    }
  }
  return recorded;
}

export async function invalidateMailCalendarCommitmentIntakes(
  transaction: DatabaseTransaction,
  input: {
    accountId: string;
    invalidatedAt: Date;
    principal: IntakePrincipal;
    reasonCode: "account_disconnected" | "mail_capability_disabled";
    requestId: string;
  },
): Promise<number> {
  const rows = await transaction
    .select()
    .from(mailCalendarCommitmentIntakes)
    .where(
      and(
        eq(mailCalendarCommitmentIntakes.accountId, input.accountId),
        eq(mailCalendarCommitmentIntakes.userId, input.principal.userId),
      ),
    )
    .orderBy(mailCalendarCommitmentIntakes.id)
    .for("update");
  for (const existing of rows) {
    const intake = requireDatabaseRecord(
      (
        await transaction
          .update(mailCalendarCommitmentIntakes)
          .set({
            authority: "provider_projected_unverified",
            evidenceKind: `source_${input.reasonCode}`,
            sourceMessageId: null,
            sourceThreadId: null,
            status: "preview_only",
            updatedAt: input.invalidatedAt,
          })
          .where(eq(mailCalendarCommitmentIntakes.id, existing.id))
          .returning()
      )[0],
      "The Mail-to-Calendar intake could not be invalidated.",
    );
    await writeIntakeAudit(transaction, {
      action: "mail_calendar_intake.source_unavailable",
      after: intake,
      before: existing,
      principal: input.principal,
      requestId: input.requestId,
    });
  }
  return rows.length;
}

export async function reconcileMissingMailCalendarCommitmentMessages(
  transaction: DatabaseTransaction,
  input: {
    accountId: string;
    observedRemoteMessageIds: ReadonlySet<string>;
    principal: IntakePrincipal;
    reconciledAt: Date;
    requestId: string;
    thread: MailThreadRow;
  },
): Promise<number> {
  if (
    input.thread.userId !== input.principal.userId ||
    input.thread.accountId !== input.accountId
  ) {
    throw new AppError(
      "forbidden",
      "Missing Mail-to-Calendar messages require one owned account and thread topology.",
    );
  }
  const candidates = await transaction
    .select({ remoteMessageId: mailCalendarCommitmentIntakes.remoteMessageId })
    .from(mailCalendarCommitmentIntakes)
    .where(
      and(
        eq(mailCalendarCommitmentIntakes.accountId, input.accountId),
        eq(mailCalendarCommitmentIntakes.remoteThreadId, input.thread.remoteThreadId),
      ),
    );
  const storedMessages = await transaction
    .select({ remoteMessageId: mailMessages.remoteMessageId })
    .from(mailMessages)
    .where(eq(mailMessages.threadId, input.thread.id));
  const missingRemoteMessageIds = [
    ...new Set(
      [...candidates, ...storedMessages]
        .map((candidate) => candidate.remoteMessageId)
        .filter((remoteMessageId) => !input.observedRemoteMessageIds.has(remoteMessageId)),
    ),
  ].sort();
  let demoted = 0;
  for (const remoteMessageId of missingRemoteMessageIds) {
    const lockKey = mailCommitmentMessageLockKey(input.accountId, remoteMessageId);
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const rows = await transaction
      .select()
      .from(mailCalendarCommitmentIntakes)
      .where(
        and(
          eq(mailCalendarCommitmentIntakes.accountId, input.accountId),
          eq(mailCalendarCommitmentIntakes.remoteMessageId, remoteMessageId),
        ),
      )
      .orderBy(mailCalendarCommitmentIntakes.id)
      .for("update");
    for (const existing of rows) {
      const changed =
        existing.authority !== "provider_projected_unverified" ||
        existing.status !== "preview_only" ||
        existing.evidenceKind !== "source_message_missing" ||
        existing.sourceMessageId !== null;
      const intake = requireDatabaseRecord(
        (
          await transaction
            .update(mailCalendarCommitmentIntakes)
            .set({
              authority: "provider_projected_unverified",
              evidenceKind: "source_message_missing",
              sourceMessageId: null,
              sourceThreadId: input.thread.id,
              sourceThreadRevision: input.thread.updatedAt,
              status: "preview_only",
              updatedAt: input.reconciledAt,
            })
            .where(eq(mailCalendarCommitmentIntakes.id, existing.id))
            .returning()
        )[0],
        "The missing Mail-to-Calendar source message could not be reconciled.",
      );
      if (changed) {
        await writeIntakeAudit(transaction, {
          action: "mail_calendar_intake.source_unavailable",
          after: intake,
          before: existing,
          changedFields: changedFieldNames([
            { after: intake.authority, before: existing.authority, name: "authority" },
            { after: intake.status, before: existing.status, name: "status" },
            { after: intake.evidenceKind, before: existing.evidenceKind, name: "evidenceKind" },
            {
              after: intake.sourceMessageId,
              before: existing.sourceMessageId,
              name: "sourceMessage",
            },
          ]),
          principal: input.principal,
          requestId: input.requestId,
        });
        demoted += 1;
      }
    }
    await transaction
      .delete(mailMessages)
      .where(
        and(
          eq(mailMessages.threadId, input.thread.id),
          eq(mailMessages.remoteMessageId, remoteMessageId),
        ),
      );
  }
  return demoted;
}

export async function reconcileMailCalendarMailboxRevisionChange(
  transaction: DatabaseTransaction,
  input: {
    accountId: string;
    mailboxId: string;
    principal: IntakePrincipal;
    reconciledAt: Date;
    requestId: string;
  },
): Promise<number> {
  const candidates = await transaction
    .select({ remoteMessageId: mailCalendarCommitmentIntakes.remoteMessageId })
    .from(mailCalendarCommitmentIntakes)
    .where(
      and(
        eq(mailCalendarCommitmentIntakes.accountId, input.accountId),
        eq(mailCalendarCommitmentIntakes.userId, input.principal.userId),
        sql<boolean>`${mailCalendarCommitmentIntakes.sourceMessageMailboxIds} @> ${JSON.stringify([input.mailboxId])}::jsonb`,
      ),
    );
  let demoted = 0;
  for (const remoteMessageId of [
    ...new Set(candidates.map((candidate) => candidate.remoteMessageId)),
  ].sort()) {
    const lockKey = mailCommitmentMessageLockKey(input.accountId, remoteMessageId);
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const rows = await transaction
      .select()
      .from(mailCalendarCommitmentIntakes)
      .where(
        and(
          eq(mailCalendarCommitmentIntakes.accountId, input.accountId),
          eq(mailCalendarCommitmentIntakes.remoteMessageId, remoteMessageId),
        ),
      )
      .orderBy(mailCalendarCommitmentIntakes.id)
      .for("update");
    for (const existing of rows) {
      const changed =
        existing.authority !== "provider_projected_unverified" ||
        existing.status !== "preview_only" ||
        existing.evidenceKind !== "source_mailbox_revision_changed" ||
        existing.sourceMessageId !== null ||
        existing.sourceThreadId !== null;
      const intake = requireDatabaseRecord(
        (
          await transaction
            .update(mailCalendarCommitmentIntakes)
            .set({
              authority: "provider_projected_unverified",
              evidenceKind: "source_mailbox_revision_changed",
              sourceMessageId: null,
              sourceThreadId: null,
              status: "preview_only",
              updatedAt: input.reconciledAt,
            })
            .where(eq(mailCalendarCommitmentIntakes.id, existing.id))
            .returning()
        )[0],
        "The changed Mail mailbox revision could not be reconciled.",
      );
      if (changed) {
        await writeIntakeAudit(transaction, {
          action: "mail_calendar_intake.source_unavailable",
          after: intake,
          before: existing,
          changedFields: [
            "mailboxRevision",
            ...changedFieldNames([
              { after: intake.authority, before: existing.authority, name: "authority" },
              { after: intake.status, before: existing.status, name: "status" },
              { after: intake.evidenceKind, before: existing.evidenceKind, name: "evidenceKind" },
              {
                after: intake.sourceMessageId,
                before: existing.sourceMessageId,
                name: "sourceMessage",
              },
              {
                after: intake.sourceThreadId,
                before: existing.sourceThreadId,
                name: "sourceThread",
              },
            ]),
          ],
          principal: input.principal,
          requestId: input.requestId,
        });
        demoted += 1;
      }
    }
  }
  return demoted;
}
