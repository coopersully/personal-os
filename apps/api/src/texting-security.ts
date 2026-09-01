import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";

type Receipt = {
  actorId: string;
  connectionId: string;
  consentEpoch: number;
  exp: number;
  revision: number;
  timeZone: string;
  userId: string;
};

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/** Bind a short-lived send capability to the exact conversation state an agent read. */
export function issueConversationReceipt(value: Receipt, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

/** Reject a send capability if its signature, actor, connection, consent, or revision changed. */
export function verifyConversationReceipt(
  token: string,
  expected: Omit<Receipt, "exp">,
  secret: string,
  now: Date,
): void {
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra)
    throw new AppError("conflict", "Read the conversation immediately before sending.");
  const actual = signature(payload, secret);
  if (
    actual.length !== supplied.length ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(supplied))
  ) {
    throw new AppError("conflict", "Read the conversation immediately before sending.");
  }
  let value: Receipt;
  try {
    value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Receipt;
  } catch {
    throw new AppError("conflict", "Read the conversation immediately before sending.");
  }
  if (
    value.exp < now.getTime() ||
    value.actorId !== expected.actorId ||
    value.connectionId !== expected.connectionId ||
    value.consentEpoch !== expected.consentEpoch ||
    value.userId !== expected.userId ||
    value.revision !== expected.revision ||
    value.timeZone !== expected.timeZone
  ) {
    throw new AppError(
      "conflict",
      "The conversation changed or the read receipt expired. Read it again before sending.",
    );
  }
}
