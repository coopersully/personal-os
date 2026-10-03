import type { AgentAccessWorkItem } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { QueryFeedback } from "@/components/async-state";
import { MutationFeedback } from "@/components/mutation-feedback";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "../../api.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { FinanceContextualQuestionPage } from "../finances/contextual-question.js";
import { requireFinanceResult } from "../finances/position-material.js";
import { ReviewQuestion } from "../finances/review-page.js";
import { FinanceAgentReviewQueue } from "../finances/review-queue.js";
import { TransactionSummary } from "../finances/transaction-summary.js";

type ActionsProps = { item: AgentAccessWorkItem; onChanged: () => Promise<void> };
export function ReviewActions({ item, onChanged }: ActionsProps) {
  const id = item.id.split(":")[1] as string;
  if (item.id.startsWith("attention:"))
    return <AttentionActions item={item} onChanged={onChanged} />;
  if (item.id.startsWith("mail-rule:")) return <MailRuleActions id={id} onChanged={onChanged} />;
  if (item.id.startsWith("mail-question:") || item.id.startsWith("mail-run:"))
    return (
      <MailQuestionActions
        id={item.id.startsWith("mail-question:") ? id : undefined}
        onChanged={onChanged}
      />
    );
  if (item.id.startsWith("finance-contextual:"))
    return <FinanceContextualQuestionPage id={id} onChanged={onChanged} />;
  if (item.id.startsWith("finance-action:"))
    return (
      <FinanceAgentReviewQueue
        {...(item.action?.to.includes("question=") ? { questionId: id } : { approvalId: id })}
        onChanged={onChanged}
      />
    );
  if (item.id.startsWith("finance-review:"))
    return item.action?.to.includes("/legacy") ? (
      <LegacyFinanceActions id={id} onChanged={onChanged} />
    ) : (
      <FinanceInboxActions id={id} onChanged={onChanged} />
    );
  return (
    <div className="grid gap-2">
      {item.action ? (
        <Button asChild variant="outline">
          <Link to={item.action.to}>{item.action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

function AttentionActions({ item, onChanged }: ActionsProps) {
  const query = useQuery({
    queryKey: ["review-attention", item.domain],
    queryFn: () =>
      api.listAttentionItems({ domain: item.domain ?? "mail", status: "open", limit: 100 }),
  });
  const current = query.data?.find((entry) => `attention:${entry.id}` === item.id);
  const mutation = useFeedbackMutation({
    feedback: { action: "update this attention item", safeToRetry: false, form: false },
    mutationFn: (status: "resolved" | "dismissed") => {
      if (!current || !item.domain) throw new Error("Reload this item before responding.");
      return api.updateAttentionItem(item.domain, current.id, {
        expectedVersion: current.version,
        status,
      });
    },
    onSuccess: onChanged,
  });
  return (
    <div className="grid gap-3">
      <QueryFeedback query={query} title="Couldn’t load the current item." />
      <MutationFeedback feedback={mutation.feedback} />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!current || mutation.isPending || query.isError}
          onClick={() => mutation.mutate("resolved")}
        >
          Mark resolved
        </Button>
        <Button
          disabled={!current || mutation.isPending || query.isError}
          variant="outline"
          onClick={() => mutation.mutate("dismissed")}
        >
          Dismiss
        </Button>
      </div>
      {!current && !query.isPending && !query.isError ? (
        <p>This item is no longer available. Check its status to continue.</p>
      ) : null}
    </div>
  );
}

function MailRuleActions({ id, onChanged }: { id: string; onChanged: ActionsProps["onChanged"] }) {
  const preview = useQuery({
    queryKey: ["mail-rule-preview", id],
    queryFn: () => api.previewSavedMailRule(id),
  });
  const profile = useQuery({
    queryKey: ["assistant-setup-status"],
    queryFn: api.getAssistantSetupStatus,
  });
  const rules = useQuery({ queryKey: ["mail-rules"], queryFn: api.listMailRules });
  const accounts = useQuery({ queryKey: ["mail-setup-context"], queryFn: api.getMailSetupContext });
  const accountNames = new Map(
    accounts.data?.accounts.map((account) => [account.accountId, account.email ?? account.label]) ??
      [],
  );
  const rule = rules.data?.find((rule) => rule.id === id);
  const activeProfile =
    profile.data?.domains.find((entry) => entry.domain === "mail")?.profileStatus === "active";
  const mutation = useFeedbackMutation({
    feedback: { action: "activate this mail rule", safeToRetry: false, form: false },
    mutationFn: () => {
      const value = preview.data;
      if (!value || value.ruleVersion === null)
        throw new Error("Refresh the preview before activating.");
      return api.activateMailRule(id, {
        expectedCandidateIds: value.candidates.map((candidate) => candidate.id),
        expectedPreviewFingerprint: value.fingerprint,
        expectedPreviewedAt: value.previewedAt,
        expectedVersion: value.ruleVersion,
      });
    },
    onSuccess: onChanged,
  });
  return (
    <div className="grid gap-3">
      <QueryFeedback query={preview} title="Couldn’t load current rule matches." />
      <QueryFeedback query={profile} title="Couldn’t verify Mail’s profile." />
      <QueryFeedback query={rules} title="Couldn’t load current rule scope." />
      <QueryFeedback query={accounts} title="Couldn’t load rule accounts." />
      <MutationFeedback feedback={mutation.feedback} />
      {preview.data ? (
        <>
          <h3 className="font-medium">{rule?.name ?? "Activate this mail rule?"}</h3>
          <p className="text-sm">
            {preview.data.matchedCount} current matches in a bounded recent sample. This rule also
            applies to future matching mail.
            {` Reviewed ${preview.data.scannedCount} of ${preview.data.window.limit} recent conversations.`}
            {preview.data.window.truncated ? ` (more than ${preview.data.window.limit} exist)` : ""}
            {rule
              ? ` Rule scope: ${rule.sourceIds.length ? rule.sourceIds.map((source) => accountNames.get(source) ?? "Unknown account").join(", ") : "no explicit account selected"}.`
              : ""}
          </p>
          <ul className="grid gap-2 text-sm">
            {preview.data.candidates.map((candidate) => (
              <li key={candidate.id} className="rounded-lg bg-secondary p-3">
                <span>{candidate.subject || "(No subject)"}</span> · {candidate.from.address} ·{" "}
                {accountNames.get(candidate.accountId) ?? "Unknown account"}
                <span className="block text-muted-foreground">
                  {candidate.actions
                    .map(
                      (action) =>
                        `${action.type === "trash" ? "recoverable Trash" : action.type.replaceAll("_", " ")}${action.afterDays ? ` after ${action.afterDays}d` : ""} — ${action.due ? "due now" : "retained until due"}`,
                    )
                    .join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p role="status">Checking current matches…</p>
      )}
      {!activeProfile ? <p className="text-sm">Activate your Mail profile first</p> : null}
      <Button
        disabled={
          !preview.data ||
          preview.isError ||
          !rule ||
          rules.isError ||
          accounts.isError ||
          accounts.isPending ||
          profile.isError ||
          !activeProfile ||
          preview.data.ruleVersion === null ||
          mutation.isPending
        }
        onClick={() => mutation.mutate()}
      >
        Activate reviewed rule
      </Button>
    </div>
  );
}

function MailQuestionActions({
  id,
  onChanged,
}: {
  id: string | undefined;
  onChanged: ActionsProps["onChanged"];
}) {
  const query = useQuery({ queryKey: ["review-mail-status"], queryFn: api.getMailStatus });
  const question = query.data?.details.openQuestions.find((question) => !id || question.id === id);
  const [answer, setAnswer] = useState("");
  const mutation = useFeedbackMutation({
    feedback: { action: "answer this Mail question", safeToRetry: false, form: false },
    mutationFn: (value: string) => {
      if (!question) throw new Error("This question is unavailable.");
      return api.answerMailQuestion(question.id, {
        answer: value,
        expectedVersion: question.version,
        generalize: false,
      });
    },
    onSuccess: async () => {
      await query.refetch();
      setAnswer("");
      await onChanged();
    },
  });
  return (
    <div className="grid gap-3">
      <QueryFeedback query={query} title="Couldn’t load the Mail question." />
      <MutationFeedback feedback={mutation.feedback} />
      {question ? (
        <>
          <p>{question.reason}</p>
          {question.options.length ? (
            <div className="flex flex-wrap gap-2">
              {question.options.map((option) => (
                <Button
                  key={option.value}
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : (
            <>
              <Input
                aria-label="Your answer"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
              />
              <Button
                disabled={!answer.trim() || mutation.isPending}
                onClick={() => mutation.mutate(answer.trim())}
              >
                Save answer
              </Button>
            </>
          )}
        </>
      ) : (
        <p className="text-sm">
          {query.isPending
            ? "Loading questions…"
            : "No open question is available. Check status after addressing the reported blocker."}
        </p>
      )}
    </div>
  );
}

function FinanceInboxActions({
  id,
  onChanged,
}: {
  id: string;
  onChanged: ActionsProps["onChanged"];
}) {
  const query = useQuery({
    queryKey: ["finance-inbox"],
    queryFn: async () => requireFinanceResult(await api.getFinanceInbox()),
  });
  const review = query.data?.data.find((item) => item.id === id);
  return (
    <>
      <QueryFeedback query={query} title="Couldn’t load the financial decision." />
      {review ? (
        <ReviewQuestion
          review={review}
          prompt={
            review.prompt ??
            (query.data?.communication.nextQuestion?.id === id
              ? query.data.communication.nextQuestion.prompt
              : "What should we know about this item?")
          }
          headline=""
          onResponse={() => {
            void query.refetch();
            void onChanged();
          }}
        />
      ) : (
        <p>
          {query.isPending
            ? "Loading decision…"
            : "This decision is no longer available. Check status to continue."}
        </p>
      )}
    </>
  );
}

function LegacyFinanceActions({
  id,
  onChanged,
}: {
  id: string;
  onChanged: ActionsProps["onChanged"];
}) {
  const query = useQuery({
    queryKey: ["review-finance-legacy", id],
    queryFn: () => api.getFinanceReviewQueue(50, id),
  });
  const categories = useQuery({
    queryKey: ["finance-categories"],
    queryFn: api.getFinanceCategories,
  });
  const [category, setCategory] = useState("");
  const review = query.data?.find((item) => item.id === id);
  const mutation = useFeedbackMutation({
    feedback: { action: "resolve this transaction review", safeToRetry: false, form: false },
    mutationFn: (action: "approve" | "confirm_transfer" | "recategorize") => {
      if (!review) throw new Error("Reload this decision.");
      return api.resolveFinanceReview(id, {
        action,
        ...(action === "recategorize" ? { categoryId: category } : {}),
        expectedTransactionUpdatedAt: review.transaction.updatedAt,
        learnMerchant: "never",
        rationale: null,
      });
    },
    onSuccess: onChanged,
  });
  return (
    <div className="grid gap-3">
      <QueryFeedback query={query} title="Couldn’t load this transaction." />
      <QueryFeedback query={categories} title="Couldn’t load categories." />
      <MutationFeedback feedback={mutation.feedback} />
      {review ? (
        <>
          <TransactionSummary transaction={review.transaction} />
          <div className="grid gap-3">
            <div>
              <h3 className="font-medium">Label this transaction</h3>
              {review.rationale ? (
                <p className="mt-1 text-sm text-muted-foreground">{review.rationale}</p>
              ) : null}
            </div>
            <div className="min-w-0 rounded-lg bg-secondary p-3">
              <label className="mb-2 block text-xs text-muted-foreground" htmlFor="review-category">
                Category
              </label>
              <SearchableSelect
                id="review-category"
                label="Category"
                value={category}
                onValueChange={setCategory}
                options={(categories.data ?? []).map((entry) => ({
                  value: entry.id,
                  label: entry.name,
                }))}
                disabled={mutation.isPending || categories.isPending || categories.isError}
                placeholder="Choose a category"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!category || mutation.isPending || query.isError || categories.isError}
              onClick={() => mutation.mutate("recategorize")}
            >
              Save category
            </Button>
            {review.reason === "possible_transfer" ? (
              <Button
                disabled={mutation.isPending || query.isError}
                onClick={() => mutation.mutate("confirm_transfer")}
              >
                Confirm transfer
              </Button>
            ) : review.transaction.categoryId ? (
              <Button
                disabled={mutation.isPending || query.isError}
                onClick={() => mutation.mutate("approve")}
              >
                Approve category
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <p>
          {query.isPending
            ? "Loading transaction…"
            : "This decision is unavailable. Check status to continue."}
        </p>
      )}
    </div>
  );
}
