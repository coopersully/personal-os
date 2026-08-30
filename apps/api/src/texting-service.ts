import { createHash, createHmac } from "node:crypto";
import {
  estimateTwilioSegments,
  type TwilioConnector,
  type TwilioMessage,
} from "@personal-os/connectors";
import {
  type Database,
  textingConnections,
  textingConsentEvents,
  textingVerificationChallenges,
  textMessages,
} from "@personal-os/database";
import {
  normalizeTextingPhoneNumber,
  type SendTextMessageInput,
  type StartTextingVerificationInput,
  type TextConversationPage,
  type TextConversationQuery,
  type TextingConnection,
  textingConsentVersion,
} from "@personal-os/domain";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { requireDatabaseRecord } from "./database.js";
import { AppError, isUniqueViolation } from "./errors.js";
import { decryptJson, encryptJson } from "./security.js";
import { issueConversationReceipt, verifyConversationReceipt } from "./texting-security.js";
import { formatTextLocalTime } from "./texting-time.js";
import type { Principal } from "./types.js";

type Options = {
  apiBaseUrl: string;
  db: Database;
  enabled: boolean;
  encryptionKey: string;
  now?: () => Date;
  senderPhoneNumber: string;
  twilio?: TwilioConnector;
};

type EncryptedPhone = { e164: string };

export function createTextingService(options: Options) {
  const now = options.now ?? (() => new Date());
  const fingerprint = (phone: string) =>
    createHmac("sha256", options.encryptionKey).update(phone).digest("hex");
  const providerReady = Boolean(options.twilio && options.senderPhoneNumber);
  const requireProvider = () => {
    if (!options.enabled || !options.twilio || !options.senderPhoneNumber)
      throw new AppError("service_unavailable", "Texting setup is not currently available.");
    return options.twilio;
  };

  async function connectionRow(userId: string) {
    return options.db.query.textingConnections.findFirst({
      where: eq(textingConnections.userId, userId),
    });
  }

  function publicConnection(row: Awaited<ReturnType<typeof connectionRow>>): TextingConnection {
    return {
      consentEpoch: row?.consentEpoch ?? 0,
      country: row?.country ?? null,
      id: row?.id ?? null,
      maskedPhoneNumber: row ? `••• ••• ${row.phoneLastFour}` : null,
      providerReady,
      senderPhoneNumber: options.senderPhoneNumber || null,
      state: row?.state ?? null,
      verifiedAt: row?.verifiedAt.toISOString() ?? null,
    };
  }

  async function startVerification(userId: string, input: StartTextingVerificationInput) {
    const twilio = requireProvider();
    const phone = normalizeTextingPhoneNumber(input);
    const verification = await twilio.startVerification(phone.e164);
    const expiresAt = new Date(now().getTime() + 10 * 60_000);
    const [createdChallenge] = await options.db
      .insert(textingVerificationChallenges)
      .values({
        consentVersion: textingConsentVersion,
        country: phone.country,
        encryptedPhoneNumber: encryptJson({ e164: phone.e164 }, options.encryptionKey),
        expiresAt,
        phoneFingerprint: fingerprint(phone.e164),
        phoneLastFour: phone.lastFour,
        providerVerificationSid: verification.sid,
        status: "pending",
        userId,
      })
      .returning();
    const challenge = requireDatabaseRecord(
      createdChallenge,
      "Could not create a verification challenge.",
    );
    return {
      expiresAt: expiresAt.toISOString(),
      id: challenge.id,
      maskedPhoneNumber: `••• ••• ${phone.lastFour}`,
      status: challenge.status,
    };
  }

  async function checkVerification(userId: string, challengeId: string, code: string) {
    const twilio = requireProvider();
    const challenge = await options.db.query.textingVerificationChallenges.findFirst({
      where: and(
        eq(textingVerificationChallenges.id, challengeId),
        eq(textingVerificationChallenges.userId, userId),
      ),
    });
    if (challenge?.status !== "pending")
      throw new AppError("not_found", "Verification challenge not found.");
    if (challenge.expiresAt <= now())
      throw new AppError("invalid_request", "The verification code expired. Request a new one.");
    const status = await twilio.checkVerification(challenge.providerVerificationSid, code);
    if (status !== "approved") {
      if (status === "failed")
        await options.db
          .update(textingVerificationChallenges)
          .set({ status: "failed" })
          .where(eq(textingVerificationChallenges.id, challenge.id));
      throw new AppError("invalid_request", "That verification code was not accepted.");
    }
    try {
      await options.db.transaction(async (tx) => {
        const blocked = await tx.query.textingConsentEvents.findFirst({
          orderBy: [
            desc(textingConsentEvents.occurredAt),
            desc(textingConsentEvents.createdAt),
            desc(textingConsentEvents.id),
          ],
          where: and(
            eq(textingConsentEvents.phoneFingerprint, challenge.phoneFingerprint),
            inArray(textingConsentEvents.kind, [
              "provider_stop",
              "provider_start",
              "provider_block",
            ]),
          ),
        });
        const existing = await tx.query.textingConnections.findFirst({
          where: eq(textingConnections.userId, userId),
        });
        const state =
          blocked?.kind === "provider_stop" || blocked?.kind === "provider_block"
            ? "opted_out"
            : "active";
        let connectionId: string;
        if (existing) {
          connectionId = existing.id;
          await tx
            .update(textingConnections)
            .set({
              consentEpoch: existing.consentEpoch + 1,
              consentVersion: textingConsentVersion,
              country: challenge.country,
              disconnectedAt: null,
              encryptedPhoneNumber: challenge.encryptedPhoneNumber,
              optedOutAt: state === "opted_out" ? now() : null,
              phoneFingerprint: challenge.phoneFingerprint,
              phoneLastFour: challenge.phoneLastFour,
              state,
              updatedAt: now(),
              verifiedAt: now(),
            })
            .where(eq(textingConnections.id, existing.id));
        } else {
          const [createdConnection] = await tx
            .insert(textingConnections)
            .values({
              consentVersion: textingConsentVersion,
              country: challenge.country,
              encryptedPhoneNumber: challenge.encryptedPhoneNumber,
              phoneFingerprint: challenge.phoneFingerprint,
              phoneLastFour: challenge.phoneLastFour,
              state,
              userId,
              verifiedAt: now(),
            })
            .returning({ id: textingConnections.id });
          const created = requireDatabaseRecord(createdConnection, "Connection insert failed.");
          connectionId = created.id;
        }
        await tx.insert(textingConsentEvents).values({
          connectionId,
          kind: "verified_opt_in",
          occurredAt: now(),
          phoneFingerprint: challenge.phoneFingerprint,
          source: "ilo",
          userId,
        });
        await tx
          .update(textingVerificationChallenges)
          .set({ approvedAt: now(), status: "approved" })
          .where(eq(textingVerificationChallenges.id, challenge.id));
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new AppError(
          "conflict",
          "That phone number is already connected to another ilo account.",
        );
      /* v8 ignore next -- unexpected database failures propagate through the shared API error boundary */
      throw error;
    }
    return publicConnection(await connectionRow(userId));
  }

  async function disconnect(userId: string) {
    const row = await connectionRow(userId);
    if (!row) return;
    await options.db.transaction(async (tx) => {
      await tx
        .update(textingConnections)
        .set({ disconnectedAt: now(), state: "disconnected", updatedAt: now() })
        .where(eq(textingConnections.id, row.id));
      await tx.insert(textingConsentEvents).values({
        connectionId: row.id,
        kind: "disconnected",
        occurredAt: now(),
        phoneFingerprint: row.phoneFingerprint,
        source: "ilo",
        userId,
      });
    });
  }

  async function conversation(
    principal: Principal,
    timeZone: string,
    query: TextConversationQuery,
  ): Promise<TextConversationPage> {
    const row = await connectionRow(principal.userId);
    const current = now();
    if (!row)
      return {
        asOf: current.toISOString(),
        connection: publicConnection(undefined),
        conversationReceipt: null,
        currentLocalDateTime: formatTextLocalTime(current, timeZone),
        earlierCursor: null,
        hasEarlierMessages: false,
        messages: [],
        newerCursor: null,
        timeZone,
      };
    const messages = await options.db
      .select()
      .from(textMessages)
      .where(eq(textMessages.connectionId, row.id))
      .orderBy(desc(textMessages.occurredAt), desc(textMessages.id))
      .limit(query.limit + 1);
    const visible = messages.slice(0, query.limit).reverse();
    const receipt = issueConversationReceipt(
      {
        actorId: principal.actorId,
        exp: current.getTime() + 5 * 60_000,
        revision: row.conversationRevision,
        timeZone,
        userId: principal.userId,
      },
      options.encryptionKey,
    );
    return {
      asOf: current.toISOString(),
      connection: publicConnection(row),
      conversationReceipt: receipt,
      currentLocalDateTime: formatTextLocalTime(current, timeZone),
      /* v8 ignore next -- the true branch guarantees at least one visible row because limit is positive */
      earlierCursor: messages.length > query.limit ? (visible[0]?.id ?? null) : null,
      hasEarlierMessages: messages.length > query.limit,
      messages: visible.map((message) => ({
        actualSegments: message.actualSegments,
        contentKind: message.contentKind,
        deliveredAt: message.deliveredAt?.toISOString() ?? null,
        direction: message.direction,
        id: message.id,
        localDateTime: formatTextLocalTime(message.occurredAt, timeZone),
        occurredAt: message.occurredAt.toISOString(),
        occurredAtSource: message.occurredAtSource,
        predictedSegments: message.predictedSegments,
        sentAt: message.sentAt?.toISOString() ?? null,
        seriesId: message.seriesId,
        seriesPart: message.seriesPart,
        seriesTotal: message.seriesTotal,
        status: message.status,
        text: message.body,
      })),
      newerCursor: null,
      timeZone,
    };
  }

  function reviewToken(body: string, level: "review" | "exceptional") {
    return createHmac("sha256", options.encryptionKey)
      .update(`${level}:${createHash("sha256").update(body).digest("hex")}`)
      .digest("base64url");
  }

  async function send(principal: Principal, timeZone: string, input: SendTextMessageInput) {
    const twilio = requireProvider();
    const row = await connectionRow(principal.userId);
    if (row?.state !== "active")
      throw new AppError(
        "forbidden",
        "Texting is not active. The user may need to reply START or reconnect.",
      );
    verifyConversationReceipt(
      input.conversationReceipt,
      {
        actorId: principal.actorId,
        revision: row.conversationRevision,
        timeZone,
        userId: principal.userId,
      },
      options.encryptionKey,
      now(),
    );
    const isSeries = input.seriesId || input.seriesPart || input.seriesTotal;
    if (
      isSeries &&
      (!input.seriesId ||
        !input.seriesPart ||
        !input.seriesTotal ||
        !["structured_data", "requested_large_content"].includes(input.contentKind))
    ) {
      throw new AppError(
        "invalid_request",
        "A 2–3 message series is only for structured data or explicitly requested large content, with complete series fields.",
      );
    }
    const optOut =
      row.consentEpoch > 0 &&
      !(await options.db.query.textMessages.findFirst({
        where: and(eq(textMessages.connectionId, row.id), eq(textMessages.direction, "outbound")),
      }));
    const prefix = isSeries ? `ilo (${input.seriesPart}/${input.seriesTotal}): ` : "ilo: ";
    const body = `${prefix}${input.body}${optOut ? "\nReply STOP to unsubscribe." : ""}`;
    const estimate = estimateTwilioSegments(body);
    if (estimate.segments > 10)
      throw new AppError(
        "invalid_request",
        "This text exceeds the 10-bubble maximum. Condense it or use another channel.",
        { predictedSegments: estimate.segments },
      );
    if (estimate.segments === 3 && !input.necessity)
      throw new AppError("conflict", "Three bubbles require a concise necessity explanation.", {
        predictedSegments: estimate.segments,
      });
    if (
      estimate.segments >= 4 &&
      estimate.segments <= 6 &&
      input.lengthReviewToken !== reviewToken(body, "review")
    )
      throw new AppError(
        "conflict",
        "This unusually long text requires an explicit review and retry.",
        { lengthReviewToken: reviewToken(body, "review"), predictedSegments: estimate.segments },
      );
    if (estimate.segments >= 7 && input.exceptionalLengthToken !== reviewToken(body, "exceptional"))
      throw new AppError(
        "conflict",
        "Seven to ten bubbles are exceptional. Confirm necessity and retry with the supplied token.",
        {
          exceptionalLengthToken: reviewToken(body, "exceptional"),
          predictedSegments: estimate.segments,
        },
      );
    const minuteAgo = new Date(now().getTime() - 60_000);
    const dayAgo = new Date(now().getTime() - 24 * 60 * 60_000);
    const recent = await options.db
      .select()
      .from(textMessages)
      .where(
        and(
          eq(textMessages.userId, principal.userId),
          eq(textMessages.direction, "outbound"),
          gte(textMessages.createdAt, dayAgo),
        ),
      );
    if (
      recent.filter((message) => message.createdAt >= minuteAgo).length >= 5 ||
      recent.reduce(
        (total, message) => total + (message.actualSegments ?? message.predictedSegments ?? 1),
        0,
      ) +
        estimate.segments >
        100
    )
      throw new AppError("rate_limited", "Texting quota reached. Try again later.");
    const phone = decryptJson<EncryptedPhone>(row.encryptedPhoneNumber, options.encryptionKey).e164;
    const [createdMessage] = await options.db.transaction(async (tx) => {
      const created = await tx
        .insert(textMessages)
        .values({
          body,
          connectionId: row.id,
          contentKind: input.contentKind,
          direction: "outbound",
          occurredAt: now(),
          occurredAtSource: "ilo",
          predictedSegments: estimate.segments,
          seriesId: input.seriesId,
          seriesPart: input.seriesPart,
          seriesTotal: input.seriesTotal,
          status: "queued",
          userId: principal.userId,
        })
        .returning();
      await tx
        .update(textingConnections)
        .set({ conversationRevision: row.conversationRevision + 1, updatedAt: now() })
        .where(eq(textingConnections.id, row.id));
      return created;
    });
    const pendingMessage = requireDatabaseRecord(
      createdMessage,
      "Could not store the outgoing text message.",
    );
    let providerMessage: TwilioMessage;
    try {
      providerMessage = await twilio.sendMessage({
        body,
        statusCallback: `${options.apiBaseUrl}/v1/webhooks/twilio/message-status`,
        to: phone,
      });
    } catch (error) {
      await options.db
        .update(textMessages)
        .set({ status: "failed", updatedAt: now() })
        .where(eq(textMessages.id, pendingMessage.id));
      if (typeof error === "object" && error && "code" in error && error.code === 21610) {
        await options.db.transaction(async (tx) => {
          await tx
            .update(textingConnections)
            .set({ optedOutAt: now(), state: "opted_out", updatedAt: now() })
            .where(eq(textingConnections.id, row.id));
          await tx.insert(textingConsentEvents).values({
            connectionId: row.id,
            kind: "provider_block",
            occurredAt: now(),
            phoneFingerprint: row.phoneFingerprint,
            source: "twilio",
            userId: row.userId,
          });
        });
        throw new AppError(
          "forbidden",
          "Twilio reports this recipient has opted out. They must reply START before ilo can text again.",
        );
      }
      throw error;
    }
    const [message] = await options.db
      .update(textMessages)
      .set({
        providerMessageSid: providerMessage.sid,
        status: providerMessage.status === "queued" ? "queued" : "accepted",
        updatedAt: now(),
      })
      .where(eq(textMessages.id, pendingMessage.id))
      .returning();
    return requireDatabaseRecord(message, "Could not finalize the outgoing text message.");
  }

  async function inbound(parameters: Record<string, string>) {
    const from = parameters.From;
    const sid = parameters.MessageSid;
    if (!from || !sid) throw new AppError("invalid_request", "Missing Twilio message fields.");
    const row = await options.db.query.textingConnections.findFirst({
      where: eq(textingConnections.phoneFingerprint, fingerprint(from)),
    });
    if (!row) return;
    const body = parameters.Body ?? "";
    // Advanced Opt-Out supplies OptOutType even when the configured keyword is not literally
    // STOP/START. Treat Twilio's classification as authoritative and retain Body as the fallback.
    const keyword = (parameters.OptOutType ?? body).trim().toUpperCase();
    const state = keyword === "STOP" ? "opted_out" : keyword === "START" ? "active" : row.state;
    await options.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(textMessages)
        .values({
          actualSegments: Number(parameters.NumSegments || 1),
          body,
          connectionId: row.id,
          direction: "inbound",
          occurredAt: now(),
          occurredAtSource: "provider",
          providerMessageSid: sid,
          status: "delivered",
          userId: row.userId,
        })
        .onConflictDoNothing()
        .returning({ id: textMessages.id });
      if (!inserted) return;
      await tx
        .update(textingConnections)
        .set({
          conversationRevision: row.conversationRevision + 1,
          optedOutAt: state === "opted_out" ? now() : null,
          state,
          updatedAt: now(),
        })
        .where(eq(textingConnections.id, row.id));
      if (keyword === "STOP" || keyword === "START")
        await tx.insert(textingConsentEvents).values({
          connectionId: row.id,
          kind: keyword === "STOP" ? "provider_stop" : "provider_start",
          occurredAt: now(),
          phoneFingerprint: row.phoneFingerprint,
          source: "twilio",
          userId: row.userId,
        });
    });
  }

  async function updateStatus(parameters: Record<string, string>) {
    if (!parameters.MessageSid) return;
    const status = parameters.MessageStatus;
    const allowed = [
      "accepted",
      "queued",
      "sending",
      "sent",
      "delivered",
      "undelivered",
      "failed",
    ] as const;
    const normalized = allowed.find((value) => value === status) ?? "unknown";
    await options.db
      .update(textMessages)
      .set({
        actualSegments: parameters.NumSegments ? Number(parameters.NumSegments) : undefined,
        deliveredAt: normalized === "delivered" ? now() : undefined,
        sentAt: ["sent", "delivered"].includes(normalized) ? now() : undefined,
        status: normalized,
        updatedAt: now(),
      })
      .where(eq(textMessages.providerMessageSid, parameters.MessageSid));
  }

  return {
    checkVerification,
    conversation,
    disconnect,
    getConnection: async (userId: string) => publicConnection(await connectionRow(userId)),
    inbound,
    send,
    startVerification,
    updateStatus,
  };
}
