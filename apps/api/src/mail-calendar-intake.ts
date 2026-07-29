import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  mailCalendarCommitmentIntakes,
  type mailMessages,
  type mailThreads,
} from "@personal-os/database";
import type { MailAttachment } from "@personal-os/domain";
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

export function isCalendarCommitmentAttachment(attachment: MailAttachment): boolean {
  const [contentType = ""] = attachment.contentType.toLowerCase().split(";");
  return CALENDAR_ATTACHMENT_TYPES.has(contentType.trim());
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
  for (const attachment of input.message.attachments.filter(isCalendarCommitmentAttachment)) {
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
        existing && !sourceChanged ? existing.evidenceKind : "calendar_attachment_metadata",
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
        ? [
            ...(existing.sourceFingerprint !== intake.sourceFingerprint
              ? ["sourceFingerprint"]
              : []),
            ...(existing.attachmentFingerprint !== intake.attachmentFingerprint
              ? ["attachmentFingerprint"]
              : []),
            ...(existing.providerAccountAddressHintHash !== intake.providerAccountAddressHintHash
              ? ["providerAccountAddressHint"]
              : []),
            ...(existing.evidenceKind !== intake.evidenceKind ? ["evidenceKind"] : []),
            ...(existing.authority !== intake.authority ? ["authority"] : []),
            ...(existing.status !== intake.status ? ["status"] : []),
          ]
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
        changedFields: [
          ...(existing.sourceFingerprint !== intake.sourceFingerprint ? ["sourceFingerprint"] : []),
          ...(existing.providerAccountAddressHintHash !== intake.providerAccountAddressHintHash
            ? ["providerAccountAddressHint"]
            : []),
          ...(existing.authority !== intake.authority ? ["authority"] : []),
          ...(existing.status !== intake.status ? ["status"] : []),
          ...(existing.evidenceKind !== intake.evidenceKind ? ["evidenceKind"] : []),
        ],
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
