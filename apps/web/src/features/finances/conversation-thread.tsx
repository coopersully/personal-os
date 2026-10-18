import type { FinanceConversationMessage } from "@personal-os/domain";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

export function FinanceConversationThread({
  messages,
  onRendered,
}: {
  messages: FinanceConversationMessage[];
  onRendered: (sequence: string) => void;
}) {
  const root = useRef<HTMLOListElement>(null);
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
        <li key={message.id} data-sequence={message.sequence} className="min-w-0">
          <article
            aria-label={message.authorKind === "user" ? "Your message" : "Agent message"}
            className="grid gap-2"
          >
            <header className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span>{message.authorKind === "user" ? "You" : "Agent"}</span>
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleString()}
              </time>
            </header>
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {message.text}
            </p>
            {message.recordRefs.map((ref) => (
              <Link
                className="text-sm underline underline-offset-4"
                key={`${ref.kind}:${ref.id}`}
                to={
                  ref.kind === "transaction"
                    ? `/finances/transactions?transactionId=${encodeURIComponent(ref.id)}`
                    : ref.kind === "account"
                      ? `/finances/accounts?accountId=${encodeURIComponent(ref.id)}`
                      : ref.kind === "contextual_question"
                        ? `/finances/chat?question=${encodeURIComponent(ref.id)}`
                        : `/finances/review/legacy?item=${encodeURIComponent(ref.id)}`
                }
              >
                View {ref.kind.replaceAll("_", " ")}
              </Link>
            ))}
          </article>
        </li>
      ))}
    </ol>
  );
}
