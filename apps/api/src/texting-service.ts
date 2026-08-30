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
import { and, asc, desc, eq, gt, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
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

/** Own verified-number lifecycle, consent ordering, conversation reads, and durable SMS sends. */
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
    const expiresAt = new Date(now().getTime() + 10 * 60_000);
    const [createdChallenge] = await options.db.transaction(async (tx) => {
      await tx
        .update(textingVerificationChallenges)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(textingVerificationChallenges.userId, userId),
            inArray(textingVerificationChallenges.status, ["starting", "pending", "uncertain"]),
          ),
        );
      return tx
        .insert(textingVerificationChallenges)
        .values({
          consentVersion: textingConsentVersion,
          country: phone.country,
          encryptedPhoneNumber: encryptJson({ e164: phone.e164 }, options.encryptionKey),
          expiresAt,
          phoneFingerprint: fingerprint(phone.e164),
          phoneLastFour: phone.lastFour,
          providerVerificationSid: null,
          status: "starting",
          userId,
        })
        .returning();
    });
    const challenge = requireDatabaseRecord(
      createdChallenge,
      "Could not create a verification challenge.",
    );
    try {
      const verification = await twilio.startVerification(phone.e164);
      const [pending] = await options.db
        .update(textingVerificationChallenges)
        .set({ providerVerificationSid: verification.sid, status: "pending" })
        .where(
          and(
            eq(textingVerificationChallenges.id, challenge.id),
            eq(textingVerificationChallenges.status, "starting"),
          ),
        )
        .returning();
      const ready = requireDatabaseRecord(
        pending,
        "Could not finalize the verification challenge.",
      );
      return {
        expiresAt: expiresAt.toISOString(),
        id: ready.id,
        maskedPhoneNumber: `••• ••• ${phone.lastFour}`,
        status: "pending" as const,
      };
    } catch (error) {
      await options.db
        .update(textingVerificationChallenges)
        .set({ status: "uncertain" })
        .where(
          and(
            eq(textingVerificationChallenges.id, challenge.id),
            eq(textingVerificationChallenges.status, "starting"),
          ),
        )
        .catch(() => undefined);
      throw error;
    }
  }

  async function checkVerification(userId: string, challengeId: string, code: string) {
    const twilio = requireProvider();
    const challenge = await options.db.query.textingVerificationChallenges.findFirst({
      where: and(
        eq(textingVerificationChallenges.id, challengeId),
        eq(textingVerificationChallenges.userId, userId),
      ),
    });
    if (challenge?.status !== "pending" || !challenge.providerVerificationSid)
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
            desc(
              sql<number>`CASE WHEN ${textingConsentEvents.kind} IN ('provider_stop', 'provider_block') THEN 1 ELSE 0 END`,
            ),
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
    const cursorId = query.beforeCursor ?? query.afterCursor;
    const cursor = cursorId
      ? await options.db.query.textMessages.findFirst({
          where: and(eq(textMessages.connectionId, row.id), eq(textMessages.id, cursorId)),
        })
      : undefined;
    if (cursorId && !cursor)
      throw new AppError("invalid_request", "Conversation cursor not found.");
    const beforeCondition = cursor
      ? or(
          lt(textMessages.occurredAt, cursor.occurredAt),
          and(eq(textMessages.occurredAt, cursor.occurredAt), lt(textMessages.id, cursor.id)),
        )
      : undefined;
    const afterCondition = cursor
      ? or(
          gt(textMessages.occurredAt, cursor.occurredAt),
          and(eq(textMessages.occurredAt, cursor.occurredAt), gt(textMessages.id, cursor.id)),
        )
      : undefined;
    const conditions = and(
      eq(textMessages.connectionId, row.id),
      query.beforeCursor ? beforeCondition : query.afterCursor ? afterCondition : undefined,
    );
    const messages = query.afterCursor
      ? await options.db
          .select()
          .from(textMessages)
          .where(conditions)
          .orderBy(asc(textMessages.occurredAt), asc(textMessages.id))
          .limit(query.limit + 1)
      : await options.db
          .select()
          .from(textMessages)
          .where(conditions)
          .orderBy(desc(textMessages.occurredAt), desc(textMessages.id))
          .limit(query.limit + 1);
    const selected = messages.slice(0, query.limit);
    const visible = query.afterCursor ? selected : selected.reverse();
    const firstVisible = visible[0];
    const lastVisible = visible.at(-1);
    const hasExtra = messages.length > query.limit;
    const receipt = cursorId
      ? null
      : issueConversationReceipt(
          {
            actorId: principal.actorId,
            connectionId: row.id,
            consentEpoch: row.consentEpoch,
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
      earlierCursor:
        (query.afterCursor && firstVisible) || hasExtra ? (firstVisible?.id ?? null) : null,
      hasEarlierMessages: Boolean((query.afterCursor && firstVisible) || hasExtra),
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
      newerCursor:
        (query.beforeCursor && lastVisible) || (query.afterCursor && hasExtra)
          ? (lastVisible?.id ?? null)
          : null,
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
        connectionId: row.id,
        consentEpoch: row.consentEpoch,
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
    const { createdMessage, phone } = await options.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(textingConnections)
        .where(eq(textingConnections.userId, principal.userId))
        .for("update")
        .limit(1);
      if (locked?.state !== "active")
        throw new AppError(
          "forbidden",
          "Texting is not active. The user may need to reply START or reconnect.",
        );
      verifyConversationReceipt(
        input.conversationReceipt,
        {
          actorId: principal.actorId,
          connectionId: locked.id,
          consentEpoch: locked.consentEpoch,
          revision: locked.conversationRevision,
          timeZone,
          userId: principal.userId,
        },
        options.encryptionKey,
        now(),
      );
      const [created] = await tx
        .insert(textMessages)
        .values({
          body,
          connectionId: locked.id,
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
        .set({ conversationRevision: locked.conversationRevision + 1, updatedAt: now() })
        .where(eq(textingConnections.id, locked.id));
      return {
        createdMessage: created,
        phone: decryptJson<EncryptedPhone>(locked.encryptedPhoneNumber, options.encryptionKey).e164,
      };
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
      if (typeof error === "object" && error && "code" in error && error.code === 21610) {
        await options.db
          .update(textMessages)
          .set({ status: "failed", updatedAt: now() })
          .where(eq(textMessages.id, pendingMessage.id));
        await options.db.transaction(async (tx) => {
          const [currentConnection] = await tx
            .select()
            .from(textingConnections)
            .where(
              and(
                eq(textingConnections.phoneFingerprint, row.phoneFingerprint),
                ne(textingConnections.state, "disconnected"),
              ),
            )
            .for("update")
            .limit(1);
          if (currentConnection)
            await tx
              .update(textingConnections)
              .set({
                consentEpoch: currentConnection.consentEpoch + 1,
                optedOutAt: now(),
                state: "opted_out",
                updatedAt: now(),
              })
              .where(eq(textingConnections.id, currentConnection.id));
          await tx.insert(textingConsentEvents).values({
            connectionId: currentConnection?.id,
            kind: "provider_block",
            occurredAt: now(),
            phoneFingerprint: row.phoneFingerprint,
            source: "twilio",
            userId: currentConnection?.userId,
          });
        });
        throw new AppError(
          "forbidden",
          "Twilio reports this recipient has opted out. They must reply START before ilo can text again.",
        );
      }
      const status =
        typeof error === "object" &&
        error &&
        "status" in error &&
        typeof error.status === "number" &&
        error.status >= 400 &&
        error.status < 500
          ? "failed"
          : "unknown";
      await options.db
        .update(textMessages)
        .set({ status, updatedAt: now() })
        .where(eq(textMessages.id, pendingMessage.id));
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
    if (!options.twilio)
      throw new AppError("service_unavailable", "Texting webhooks are not currently available.");
    const routed = await options.db.query.textingConnections.findFirst({
      where: and(
        eq(textingConnections.phoneFingerprint, fingerprint(from)),
        ne(textingConnections.state, "disconnected"),
      ),
    });
    if (!routed) return;
    const occurredAt = await options.twilio.getMessageOccurredAt(sid);
    const body = parameters.Body ?? "";
    // Advanced Opt-Out supplies OptOutType even when the configured keyword is not literally
    // STOP/START. Treat Twilio's classification as authoritative and retain Body as the fallback.
    const keyword = (parameters.OptOutType ?? body).trim().toUpperCase();
    await options.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(textingConnections)
        .where(
          and(
            eq(textingConnections.phoneFingerprint, fingerprint(from)),
            ne(textingConnections.state, "disconnected"),
          ),
        )
        .for("update")
        .limit(1);
      if (!row) return;
      if (keyword === "STOP" || keyword === "START") {
        const [latest] = await tx
          .select()
          .from(textingConsentEvents)
          .where(
            and(
              eq(textingConsentEvents.phoneFingerprint, row.phoneFingerprint),
              inArray(textingConsentEvents.kind, [
                "provider_stop",
                "provider_start",
                "provider_block",
              ]),
            ),
          )
          .orderBy(
            desc(textingConsentEvents.occurredAt),
            desc(
              sql<number>`CASE WHEN ${textingConsentEvents.kind} IN ('provider_stop', 'provider_block') THEN 1 ELSE 0 END`,
            ),
            desc(textingConsentEvents.createdAt),
            desc(textingConsentEvents.id),
          )
          .limit(1);
        const [inserted] = await tx
          .insert(textingConsentEvents)
          .values({
            connectionId: row.id,
            kind: keyword === "STOP" ? "provider_stop" : "provider_start",
            occurredAt,
            phoneFingerprint: row.phoneFingerprint,
            providerEventId: sid,
            source: "twilio",
            userId: row.userId,
          })
          .onConflictDoNothing()
          .returning({ id: textingConsentEvents.id });
        if (!inserted) return;
        const isNewer = !latest || occurredAt.getTime() > latest.occurredAt.getTime();
        const stopWinsTie =
          keyword === "STOP" &&
          latest?.kind === "provider_start" &&
          occurredAt.getTime() === latest.occurredAt.getTime();
        if (isNewer || stopWinsTie)
          await tx
            .update(textingConnections)
            .set({
              consentEpoch: row.consentEpoch + 1,
              optedOutAt: keyword === "STOP" ? occurredAt : null,
              state: keyword === "STOP" ? "opted_out" : "active",
              updatedAt: now(),
            })
            .where(eq(textingConnections.id, row.id));
        return;
      }
      const [inserted] = await tx
        .insert(textMessages)
        .values({
          actualSegments: Number(parameters.NumSegments || 1),
          body,
          connectionId: row.id,
          direction: "inbound",
          occurredAt,
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
        .set({ conversationRevision: row.conversationRevision + 1, updatedAt: now() })
        .where(eq(textingConnections.id, row.id));
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
    const normalized = allowed.find((value) => value === status);
    if (!normalized) return;
    const message = await options.db.query.textMessages.findFirst({
      where: eq(textMessages.providerMessageSid, parameters.MessageSid),
    });
    if (!message) return;
    const transitions: Record<string, ReadonlySet<string>> = {
      accepted: new Set(["sending", "sent", "delivered", "undelivered", "failed"]),
      queued: new Set(["accepted", "sending", "sent", "delivered", "undelivered", "failed"]),
      sending: new Set(["sent", "delivered", "undelivered", "failed"]),
      sent: new Set(["delivered", "undelivered"]),
      unknown: new Set(allowed),
    };
    const canAdvance =
      message.status === normalized || Boolean(transitions[message.status]?.has(normalized));
    if (!canAdvance) return;
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
