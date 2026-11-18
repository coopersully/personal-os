import { ApiClientError } from "@personal-os/api-client";
import type { FinanceActivityEntry, FinanceActivityEvidencePage } from "@personal-os/domain";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import { Action, Actions } from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { useFinance } from "./data";
import { financeLabel } from "./presentation";
import { Card, Copy, FinanceRow, Section } from "./ui";

type Reference = { kind: string; id: string; sourceKind?: string };

/** Only record kinds this app can open get a destination; the rest are shown as text. */
function destination(ref: Reference) {
  const sources: Record<string, string> = {
    transaction: "finance_transaction",
    account: "finance_account",
    review_case: "finance_review_case",
    contextual_question: "finance_contextual_question",
  };
  // A reference whose stated source disagrees with its kind is evidence, not a link.
  if (ref.sourceKind !== undefined && sources[ref.kind] !== ref.sourceKind) return null;
  if (ref.kind === "transaction")
    return { pathname: "/finance-transaction" as const, params: { id: ref.id } };
  if (ref.kind === "account")
    return { pathname: "/finance-account" as const, params: { id: ref.id } };
  if (ref.kind === "review_case" || ref.kind === "contextual_question")
    return { pathname: "/finance-chat-reference" as const, params: { kind: ref.kind, id: ref.id } };
  return null;
}

const when = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const shown = (value: unknown) =>
  value === undefined
    ? "not recorded"
    : typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? "not recorded");

/** The fields a change touched, as written before and after. Unchanged fields are left out. */
function differences(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys
    .filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
    .map((key) => ({ key, before: before?.[key], after: after?.[key] }));
}

/** One recorded action with the evidence behind it: who, why, which records, what changed. */
export function ActivityEvidence({
  entry,
  onClose,
  onConversation,
}: {
  entry: FinanceActivityEntry;
  onClose: () => void;
  onConversation: () => void;
}) {
  const { api } = useFinance();
  const [more, setMore] = useState<FinanceActivityEvidencePage[]>([]);
  const [pending, setPending] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const changes = [...entry.changes, ...more.flatMap((page) => page.changes)];
  const cursor = more.length ? more.at(-1)?.nextCursor : entry.evidence?.nextCursor;
  const references = [
    ...new Map(
      [
        ...(entry.caseId ? [{ kind: "review_case", id: entry.caseId }] : []),
        ...entry.recordRefs,
        ...entry.targets,
        ...more.flatMap((page) => page.recordRefs),
      ].map((ref: Reference) => [`${ref.kind}:${ref.id}`, ref]),
    ).values(),
  ];
  async function loadMore() {
    if (!cursor || pending) return;
    setPending(true);
    const id = toast.loading("Loading more evidence…");
    try {
      const page = await api.getFinanceActivityEvidence(entry.id, { cursor });
      if (!alive.current) return toast.dismiss(id);
      // A page that does not continue exactly where this one stopped describes other evidence.
      if (
        page.entryId !== entry.id ||
        page.offset !== changes.length ||
        page.totalChanges !== entry.evidence?.totalChanges
      )
        throw new Error("Evidence page changed");
      setMore((current) => [...current, page]);
      toast.success("Evidence loaded", { id });
    } catch (error) {
      if (!alive.current) return toast.dismiss(id);
      if (error instanceof ApiClientError && [401, 403, 404].includes(error.status)) setMore([]);
      toast.error("Could not load more evidence. Try again.", { id });
    } finally {
      if (alive.current) setPending(false);
    }
  }
  const ids = [
    ["Activity", entry.id],
    ["Run", entry.runId],
    ["Action", entry.actionId],
    ["Operation", entry.sourceOperationId],
    ["Audit events", entry.auditEventIds.join(", ")],
  ].filter((item): item is [string, string] => !!item[1]);
  return (
    <>
      <FinanceRow title="All activity" icon="views" onPress={onClose} />
      <Card>
        <Copy>{financeLabel(entry.action)}</Copy>
        <Copy secondary>
          {[
            financeLabel(entry.status),
            entry.agentAccount?.displayName ?? (entry.actor ? financeLabel(entry.actor.type) : ""),
            when(entry.occurredAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Copy>
        <Copy>{entry.explanation}</Copy>
        {entry.kind === "human_answer_decision" && entry.status === "accepted" && (
          <Copy secondary>
            Answer accepted. This record does not establish an applied financial change.
          </Copy>
        )}
        {entry.kind === "notification_delivery" && (
          <Copy secondary>
            Delivery {financeLabel(entry.delivery.attemptState)} · observed{" "}
            {when(entry.delivery.observedAt)}
            {entry.delivery.evidenceState === "partial" ? " · delivery evidence is partial" : ""}
          </Copy>
        )}
      </Card>
      {references.length > 0 && (
        <Section title="Records">
          <Card rows>
            {references.map((ref) => {
              const target = destination(ref);
              const title = financeLabel(ref.kind);
              if (ref.kind === "chat")
                return (
                  <FinanceRow
                    key={`${ref.kind}:${ref.id}`}
                    title="Finance conversation"
                    icon="mail"
                    onPress={onConversation}
                  />
                );
              return (
                <FinanceRow
                  key={`${ref.kind}:${ref.id}`}
                  title={title}
                  subtitle={target ? undefined : ref.id}
                  icon="receipt"
                  onPress={target ? () => router.push(target) : undefined}
                />
              );
            })}
          </Card>
        </Section>
      )}
      {entry.sourceMessages.length > 0 && (
        <Section title="Source messages">
          <Card>
            {entry.sourceMessages.map((message) => (
              <Copy key={message.id}>
                {when(message.createdAt)}: {message.excerpt?.text ?? message.text}
              </Copy>
            ))}
          </Card>
        </Section>
      )}
      {entry.kind !== "notification_delivery" && (
        <Section title="Changes">
          <Card>
            {entry.evidence && (
              <Copy secondary>
                {changes.length} of {entry.evidence.totalChanges} audited changes loaded
                {cursor ? " · evidence incomplete" : " · complete"}
              </Copy>
            )}
            {changes.length === 0 ? (
              <Copy secondary>
                No financial before/after changes are recorded in this evidence.
              </Copy>
            ) : (
              changes.map((change) => {
                const fields = differences(change.before, change.after);
                return (
                  <Copy key={change.id}>
                    {[
                      `${financeLabel(change.recordRef.kind)}${change.action ? ` · ${financeLabel(change.action)}` : ""}`,
                      ...(fields.length
                        ? fields.map(
                            (field) =>
                              `${financeLabel(field.key)}: ${shown(field.before)} → ${shown(field.after)}`,
                          )
                        : [
                            change.before === null && change.after === null
                              ? "No field values recorded"
                              : "No field differences recorded",
                          ]),
                    ].join("\n")}
                  </Copy>
                );
              })
            )}
          </Card>
          {cursor && (
            <SettingsAccentProvider workspace="finances">
              <Actions inset={false}>
                <Action
                  label="Load more evidence"
                  disabled={pending}
                  onPress={() => void loadMore()}
                />
              </Actions>
            </SettingsAccentProvider>
          )}
        </Section>
      )}
      {entry.effect && (
        <Section title="Authority">
          <Card>
            <Copy secondary>
              {[
                `Action families: ${entry.effect.actionFamilies.map(financeLabel).join(", ") || "none"}`,
                `Significance: ${financeLabel(entry.effect.significance)}`,
                `Authority: ${financeLabel(entry.effect.authorityBasis)}`,
                entry.effect.humanApproval ? "Approved by a person in review" : "",
              ]
                .filter(Boolean)
                .join("\n")}
            </Copy>
          </Card>
        </Section>
      )}
      <Section title="References">
        <Card>
          <Copy secondary>{ids.map(([label, value]) => `${label}: ${value}`).join("\n")}</Copy>
        </Card>
      </Section>
    </>
  );
}
