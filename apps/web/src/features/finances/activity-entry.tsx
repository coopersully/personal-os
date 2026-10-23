import { ApiClientError } from "@personal-os/api-client";
import type {
  FinanceActivityEntry as Entry,
  FinanceActivityEvidencePage,
  FinanceActivityEvidenceQuery,
} from "@personal-os/domain";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemContent } from "@/components/ui/item";

function recordLink(kind: string, id: string, sourceKind?: string) {
  const known: Record<string, string> = {
    transaction: "finance_transaction",
    account: "finance_account",
    review_case: "finance_review_case",
    contextual_question: "finance_contextual_question",
  };
  if (sourceKind !== undefined && (!Object.hasOwn(known, kind) || known[kind] !== sourceKind))
    return null;
  const encoded = encodeURIComponent(id);
  if (kind === "transaction") return `/finances/transactions?transactionId=${encoded}`;
  if (kind === "review_case") return `/finances/review?case=${encoded}`;
  if (kind === "chat") return `/finances/chat?message=${encoded}`;
  if (kind === "account") return `/finances/transactions?accountId=${encoded}`;
  return null;
}

export type ReadFinanceActivityEvidence = (
  id: string,
  query: FinanceActivityEvidenceQuery,
) => Promise<FinanceActivityEvidencePage>;
export function FinanceActivityEntry({
  entry,
  readEvidence,
  onAccessDenied,
  nested = false,
}: {
  entry: Entry;
  nested?: boolean;
  readEvidence?: ReadFinanceActivityEvidence | undefined;
  onAccessDenied?: () => void;
}) {
  const [more, setMore] = useState<FinanceActivityEvidencePage[]>([]);
  const [pending, setPending] = useState(false);
  const alive = useRef(true);
  const activeToast = useRef<string | number | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (activeToast.current !== undefined) toast.dismiss(activeToast.current);
    };
  }, []);
  const changes = [...entry.changes, ...more.flatMap((page) => page.changes)];
  const cursor = more.length ? more.at(-1)?.nextCursor : entry.evidence?.nextCursor;
  async function loadMoreEvidence() {
    if (!cursor || !readEvidence || pending) return;
    setPending(true);
    const id = toast.loading("Loading more evidence…");
    activeToast.current = id;
    try {
      const result = await readEvidence(entry.id, { cursor });
      if (!alive.current) return;
      if (
        result.entryId !== entry.id ||
        result.offset !== changes.length ||
        result.totalChanges !== entry.evidence?.totalChanges
      )
        throw new Error("Evidence page changed");
      setMore((previous) => [...previous, result]);
      toast.success("Evidence loaded", { id });
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiClientError && [401, 403, 404].includes(error.status)) {
        setMore([]);
        onAccessDenied?.();
      }
      toast.error("Could not load evidence. Try again.", { id });
    } finally {
      if (alive.current) {
        setPending(false);
        activeToast.current = undefined;
      }
    }
  }
  return (
    <Item variant={nested ? "secondary" : "outline"} role="listitem">
      <ItemContent>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium break-words">{entry.action}</span>
          <span className="text-sm capitalize">{entry.status}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {entry.actor.type}
          {entry.actor.id ? ` · ${entry.actor.id}` : ""} ·{" "}
          <time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString()}</time>
        </p>
        <p className="whitespace-pre-wrap break-words">{entry.explanation}</p>
        {entry.kind === "human_answer_decision" && entry.status === "accepted" ? (
          <p className="text-sm text-muted-foreground">
            Answer accepted. This record does not establish an applied financial change.
          </p>
        ) : null}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost">Inspect evidence</Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="grid min-w-0 gap-4 pt-2">
            <dl className="grid gap-1 text-sm break-all">
              <div>
                <dt className="inline font-medium">Activity: </dt>
                <dd className="inline">{entry.id}</dd>
              </div>
              {entry.runId ? (
                <div>
                  <dt className="inline font-medium">Run: </dt>
                  <dd className="inline">{entry.runId}</dd>
                </div>
              ) : null}
              {entry.actionId ? (
                <div>
                  <dt className="inline font-medium">Action: </dt>
                  <dd className="inline">{entry.actionId}</dd>
                </div>
              ) : null}
              {entry.sourceOperationId ? (
                <div>
                  <dt className="inline font-medium">Operation: </dt>
                  <dd className="inline">{entry.sourceOperationId}</dd>
                </div>
              ) : null}
              <div>
                <dt className="inline font-medium">Audit events: </dt>
                <dd className="inline">{entry.auditEventIds.join(", ")}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-3 text-sm">
              {entry.caseId ? (
                <Link to={`/finances/review?case=${encodeURIComponent(entry.caseId)}`}>
                  Review case
                </Link>
              ) : null}
              {[
                ...new Map(
                  [
                    ...entry.recordRefs,
                    ...entry.targets,
                    ...more.flatMap((page) => page.recordRefs),
                  ].map((ref) => [`${ref.kind}-${ref.id}`, ref]),
                ).values(),
              ].map((ref) => {
                const href = recordLink(
                  ref.kind,
                  ref.id,
                  "sourceKind" in ref ? ref.sourceKind : undefined,
                );
                return href ? (
                  <Link key={`${ref.kind}-${ref.id}`} to={href}>
                    {ref.kind.replaceAll("_", " ")} · {ref.id}
                  </Link>
                ) : (
                  <span key={`${ref.kind}-${ref.id}`} className="break-all">
                    {ref.kind.replaceAll("_", " ")} · {ref.id}
                  </span>
                );
              })}
            </div>
            {entry.evidence ? (
              <p className="text-sm text-muted-foreground">
                {changes.length} of {entry.evidence.totalChanges} audited changes loaded
                {cursor ? " · Evidence incomplete" : " · Complete"}
              </p>
            ) : null}
            {entry.effect ? (
              <dl className="grid gap-1 text-sm break-all">
                <div>
                  <dt className="inline font-medium">Action families: </dt>
                  <dd className="inline">{entry.effect.actionFamilies.join(", ")}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Significance: </dt>
                  <dd className="inline">{entry.effect.significance.replaceAll("_", " ")}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Authority: </dt>
                  <dd className="inline">{entry.effect.authorityBasis.replaceAll("_", " ")}</dd>
                </div>
                {entry.effect.humanApproval ? (
                  <div>
                    <dt className="inline font-medium">Human approver: </dt>
                    <dd className="inline">
                      {entry.effect.humanApproval.actorId} · Approval review{" "}
                      {entry.effect.humanApproval.reviewId}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="inline font-medium">Candidate: </dt>
                  <dd className="inline">
                    {entry.effect.candidateId} · {entry.effect.candidateRevision}
                  </dd>
                </div>
              </dl>
            ) : null}
            {changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No financial before/after changes are recorded in this evidence.
              </p>
            ) : (
              changes.map((change) => (
                <section key={change.id} className="grid min-w-0 gap-2">
                  <h3 className="text-sm font-medium">
                    {change.recordRef.kind} · {change.recordRef.id}
                  </h3>
                  {change.sourceRecordRef ? (
                    <p className="text-xs break-all">
                      Original record: {change.sourceRecordRef.kind} · {change.sourceRecordRef.id}
                    </p>
                  ) : null}
                  {change.actor ? (
                    <p className="text-xs break-all">
                      {change.action} · {change.actor.type} ·{" "}
                      {change.actor.id ?? "Actor ID unavailable"}
                      {change.occurredAt
                        ? ` · ${new Date(change.occurredAt).toLocaleString()}`
                        : ""}
                    </p>
                  ) : null}
                  <div className="grid min-w-0 gap-3 md:grid-cols-2">
                    {(["before", "after"] as const).map((side) => (
                      <div key={side} className="min-w-0">
                        <h4 className="text-sm capitalize">{side}</h4>
                        <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
                          {JSON.stringify(change[side], null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs break-all">
                    Audit events: {change.auditEventIds.join(", ")}
                  </p>
                </section>
              ))
            )}
            {cursor ? (
              <Button
                className="justify-self-start"
                variant="ghost"
                disabled={pending || !readEvidence}
                onClick={() => void loadMoreEvidence()}
              >
                Load more evidence
              </Button>
            ) : null}
            {entry.sourceMessages.map((message) => (
              <section key={message.id} className="grid min-w-0 gap-2">
                <h3 className="text-sm font-medium">Original message · {message.sequence}</h3>
                <p className="whitespace-pre-wrap break-words">{message.text}</p>
                {message.excerpt ? (
                  <div className="grid gap-1">
                    <p className="text-xs">
                      Recorded excerpt · characters {message.excerpt.start}–{message.excerpt.end}
                    </p>
                    <blockquote className="whitespace-pre-wrap break-words text-sm">
                      {message.excerpt.text}
                    </blockquote>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No historical excerpt was recorded.
                  </p>
                )}
                <p className="text-xs break-all">Content hash: {message.contentHash}</p>
                <time dateTime={message.createdAt} className="text-xs">
                  {new Date(message.createdAt).toLocaleString()}
                </time>
                <Link
                  className="text-sm"
                  to={`/finances/chat?message=${encodeURIComponent(message.id)}`}
                >
                  Open source message
                </Link>
              </section>
            ))}
          </CollapsibleContent>
        </Collapsible>
      </ItemContent>
    </Item>
  );
}
