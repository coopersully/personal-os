import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  mailCalendarCommitmentIntakes,
  type mailMessages,
  type mailThreads,
} from "@personal-os/database";
import type { MailAttachment } from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
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
    accountId: intake.accountId,
    authority: intake.authority,
    evidenceKind: intake.evidenceKind,
    id: intake.id,
    remoteMessageIdHash: fingerprint(intake.remoteMessageId),
    remotePartIdHash: fingerprint(intake.remotePartId),
    status: intake.status,
  };
}

export async function recordMailCalendarCommitmentIntakes(
  transaction: DatabaseTransaction,
  input: {
    accountId: string;
    authenticatedAccountAddress: string | null;
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
  const attachments = input.message.attachments.filter(isCalendarCommitmentAttachment);
  if (attachments.length === 0) return 0;
  const sourceFingerprint = mailCommitmentSourceFingerprint(input.message);
  let recorded = 0;
  for (const attachment of attachments) {
    const authenticatedAccountAddressHash = input.authenticatedAccountAddress
      ? fingerprint(input.authenticatedAccountAddress.trim().toLowerCase())
      : null;
    const attachmentFingerprint = fingerprint({
      contentType: attachment.contentType.toLowerCase(),
      filename: attachment.filename,
      remotePartId: attachment.id,
      size: attachment.size,
    });
    const idempotencyKey = fingerprint({
      accountId: input.accountId,
      remoteMessageId: input.message.remoteMessageId,
      remotePartId: attachment.id,
    });
    const [existing] = await transaction
      .select()
      .from(mailCalendarCommitmentIntakes)
      .where(
        and(
          eq(mailCalendarCommitmentIntakes.accountId, input.accountId),
          eq(mailCalendarCommitmentIntakes.remoteMessageId, input.message.remoteMessageId),
          eq(mailCalendarCommitmentIntakes.remotePartId, attachment.id),
        ),
      )
      .limit(1);
    const sourceChanged =
      existing !== undefined &&
      (existing.sourceFingerprint !== sourceFingerprint ||
        existing.attachmentFingerprint !== attachmentFingerprint ||
        existing.authenticatedAccountAddressHash !== authenticatedAccountAddressHash);
    const values = {
      accountId: input.accountId,
      attachment,
      attachmentFingerprint,
      authenticatedAccountAddressHash,
      authority:
        existing && !sourceChanged
          ? existing.authority
          : ("provider_projected_unverified" as const),
      evidenceKind:
        existing && !sourceChanged ? existing.evidenceKind : "calendar_attachment_metadata",
      idempotencyKey,
      remoteMessageId: input.message.remoteMessageId,
      remotePartId: attachment.id,
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
      existing.authority !== intake.authority ||
      existing.status !== intake.status;
    if (changed) {
      await transaction.insert(auditEvents).values(
        auditValues({
          action: existing
            ? "mail_calendar_intake.source_changed"
            : "mail_calendar_intake.recorded",
          after: safeAuditMetadata(intake),
          before: safeAuditMetadata(existing ?? null),
          entityId: intake.id,
          entityType: "mail_calendar_commitment_intake",
          principal: input.principal,
          requestId: input.requestId,
        }),
      );
    }
    recorded += existing ? 0 : 1;
  }
  return recorded;
}
