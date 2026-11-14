import type { FinanceConversationMessage } from "@personal-os/domain";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

const referenceRoutes = {
  transaction: ["View transaction", "/finances/transactions?transactionId="],
  account: ["View account", "/finances/accounts?accountId="],
  contextual_question: ["View contextual question", "/finances/chat?question="],
  review_case: ["View review case", "/finances/review/legacy?item="],
  budget_plan: ["View budget proposal", "/finances/plan?planId="],
  review_batch: ["Review grouped decisions", "/finances/chat?batch="],
} as const;

export function FinanceConversationThread({
  messages,
  onRendered,
  targetMessageId = null,
}: {
  messages: FinanceConversationMessage[];
  onRendered: (sequence: string) => void;
  targetMessageId?: string | null;
}) {
  const root = useRef<HTMLOListElement>(null);
  const focusedTarget = useRef<string | null>(null);
  useEffect(() => {
    if (!targetMessageId) {
      focusedTarget.current = null;
      return;
    }
    if (
      focusedTarget.current === targetMessageId ||
      !messages.some((message) => message.id === targetMessageId)
    )
      return;
    const element = Array.from(root.current?.children ?? []).find(
      (child) => (child as HTMLElement).dataset.messageId === targetMessageId,
    ) as HTMLElement | undefined;
    if (!element) return;
    element.scrollIntoView?.({ block: "center" });
    element.focus({ preventScroll: true });
    focusedTarget.current = targetMessageId;
  }, [targetMessageId, messages]);
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (document.visibilityState !== "visible") return;
        for (const entry of entries) {
          const sequence = (entry.target as HTMLElement).dataset.sequence;
          if (entry.isIntersecting && sequence) onRendered(sequence);
        }
      },
      { threshold: 0 },
    );
    for (const message of messages) {
      const element = root.current.querySelector(`[data-sequence="${message.sequence}"]`);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [messages, onRendered]);
  return (
    <ol ref={root} aria-label="Finance conversation" className="grid min-w-0 gap-6">
      {messages.map((message) => (
        <li
          key={message.id}
          data-message-id={message.id}
          data-sequence={message.sequence}
          tabIndex={-1}
          aria-current={message.id === targetMessageId ? "true" : undefined}
          aria-label={message.id === targetMessageId ? "Source message" : undefined}
          className="min-w-0"
        >
          <article
            aria-label={message.authorKind === "user" ? "Your message" : "Agent message"}
            className="grid gap-2"
          >
            {message.id === targetMessageId ? (
              <p className="text-sm font-medium">Source message</p>
            ) : null}
            <header className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span>{message.authorKind === "user" ? "You" : "Agent"}</span>
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleString()}
              </time>
            </header>
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {message.text}
            </p>
            {message.recordRefs.map((ref) => {
              // Reference kinds this client cannot open yet are omitted, never linked nowhere.
              if (!(ref.kind in referenceRoutes)) return null;
              const [label, route] = referenceRoutes[ref.kind as keyof typeof referenceRoutes];
              return (
                <Link
                  className="text-sm underline underline-offset-4"
                  key={`${ref.kind}:${ref.id}${ref.kind === "budget_plan" ? `:${ref.budgetVersionId}` : ""}`}
                  to={`${route}${encodeURIComponent(ref.id)}${ref.kind === "budget_plan" ? `&versionId=${encodeURIComponent(ref.budgetVersionId)}` : ""}`}
                >
                  {ref.kind === "account" && ref.displayLabel ? ref.displayLabel : label}
                </Link>
              );
            })}
          </article>
        </li>
      ))}
    </ol>
  );
}
