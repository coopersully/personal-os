import type { financeConversationMessages } from "@personal-os/database";

/** Illustrative history only: seeding never dispatches agent work or changes a transaction. */
export function fixtureFinanceConversation(
  userId: string,
  now: Date,
  references: {
    transactionId: string;
    messageId: (record: number) => string;
    previewRefs?: NonNullable<(typeof financeConversationMessages.$inferInsert)["recordRefs"]>;
  },
) {
  const messages = [
    {
      authorKind: "user",
      text: "Can you help me make sense of the transactions that need my input?",
    },
    {
      authorKind: "agent",
      text: "There’s a $78.25 card purchase from SQ *UNKNOWN POPUP 8821 without a category. Do you remember what it was for?",
    },
    {
      authorKind: "user",
      text: "I think that was the ceramics stall at the weekend market. I bought a birthday gift for Maya.",
    },
    {
      authorKind: "agent",
      text: "Gifts would fit that purchase. You can choose its category and add ‘Birthday gift for Maya’ as a note from Needs your input. I haven’t changed it yet.",
    },
    {
      authorKind: "user",
      text: "Thanks. Does changing this also affect other purchases from that merchant?",
    },
    {
      authorKind: "agent",
      text: "No. Editing this transaction changes only this purchase. Other purchases keep their own categories, and no merchant rule is created.",
    },
  ] satisfies { authorKind: "user" | "agent"; text: string }[];
  const originalCount = messages.length;
  if (references.previewRefs)
    messages.push(
      {
        authorKind: "user",
        text: "Can you set aside another $100 this month and check the $375 savings transfer?",
      },
      {
        authorKind: "agent",
        text: "**Budget proposal:** I moved $100 from investing to the cash buffer in the draft. It’s ready for your approval.\n\n**Transfer review:** Checking shows $375 out and savings shows $375 in. I grouped both entries for review. Neither entry has changed.",
      },
    );
  return {
    conversation: { userId, nextSequence: BigInt(messages.length) },
    messages: messages.map((message, index) => ({
      ...message,
      id: references.messageId(9000 + index),
      userId,
      sequence: BigInt(index + 1),
      idempotencyKey: `fixture-finance-conversation-${index + 1}`,
      createdAt: new Date(now.getTime() - (messages.length - index) * 120_000),
      recordRefs:
        index < originalCount
          ? [{ kind: "transaction" as const, id: references.transactionId }]
          : message.authorKind === "agent"
            ? (references.previewRefs ?? [])
            : [],
    })) satisfies (typeof financeConversationMessages.$inferInsert)[],
  };
}
