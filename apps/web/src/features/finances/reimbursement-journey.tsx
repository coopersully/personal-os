import {
  type FinanceReimbursement,
  type FinanceReimbursementEvidence,
  idSchema,
} from "@personal-os/domain";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDownIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ReimbursementCorrectionDialog } from "./reimbursement-correction-dialog.js";

/** Currency belongs to the canonical transaction, never an account or a USD default. */
export function reimbursementAmount(value: number, currency: string | null | undefined): string {
  if (currency && Intl.supportedValuesOf("currency").includes(currency))
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 20,
    }).format(value);
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 20 })} (currency unknown${currency ? `: ${currency}` : ""})`;
}

function transactionPath(id: string) {
  return `/finances/transactions?transactionId=${encodeURIComponent(id)}`;
}

function RecordedTime({ value }: { value: string }) {
  return (
    <time dateTime={value}>
      {new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}

function Evidence({ evidence }: { evidence: FinanceReimbursementEvidence }) {
  const sources = new Map(evidence.sourceRefs.map((source) => [JSON.stringify(source), source]));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p>{evidence.summary}</p>
      {[...sources].map(([key, source]) => (
        <div key={key} className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          {source.provider === "local" &&
          source.sourceType === "finance_transaction" &&
          source.remoteId !== null &&
          idSchema.safeParse(source.remoteId).success ? (
            <Link
              className="w-fit underline underline-offset-4"
              to={transactionPath(source.remoteId)}
            >
              Open source transaction
            </Link>
          ) : null}
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt>Source</dt>
            <dd>
              {source.provider} · {source.sourceType.replaceAll("_", " ")}
            </dd>
            {source.accountId ? (
              <>
                <dt>Account</dt>
                <dd className="break-words">{source.accountId}</dd>
              </>
            ) : null}
            {source.remoteId ? (
              <>
                <dt>Source reference</dt>
                <dd className="break-words">{source.remoteId}</dd>
              </>
            ) : null}
            {source.revision ? (
              <>
                <dt>Source revision</dt>
                <dd className="break-words">{source.revision}</dd>
              </>
            ) : null}
          </dl>
        </div>
      ))}
    </div>
  );
}

function ReceiptEvidence({
  reimbursement: item,
  onCorrection,
}: {
  reimbursement: FinanceReimbursement;
  onCorrection: (operation: "correct_expected" | "unmatch_credit", matchId?: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4 break-words text-sm">
      <dl className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
        <div>
          <dt className="inline">Reimbursement: </dt>
          <dd className="inline">{item.id}</dd>
        </div>
        <div>
          <dt className="inline">Expense allocation: </dt>
          <dd className="inline">{item.allocationId}</dd>
        </div>
      </dl>
      <section aria-label="Expense and reimbursement amounts" className="flex flex-col gap-2">
        {item.sourceExpense ? (
          <>
            <Link
              className="w-fit underline"
              to={transactionPath(item.sourceExpense.transactionId)}
            >
              Open original expense
            </Link>
            <p>
              {item.sourceExpense.merchant} · Expense date{" "}
              <time dateTime={item.sourceExpense.date}>{item.sourceExpense.date}</time>
              {item.sourceExpense.pending ? " · Pending expense, not settled" : " · Posted expense"}
            </p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt>Gross expense outlay</dt>
                <dd>
                  {reimbursementAmount(item.sourceExpense.amount, item.sourceExpense.currency)}
                </dd>
              </div>
              <div>
                <dt>Reimbursable allocation</dt>
                <dd>
                  {reimbursementAmount(
                    item.sourceExpense.allocationAmount,
                    item.sourceExpense.currency,
                  )}
                </dd>
              </div>
            </dl>
            <p>
              Allocation revision {item.sourceExpense.allocationRevision} ·{" "}
              {item.sourceExpense.allocationState} · {item.sourceExpense.allocationTreatment}
            </p>
          </>
        ) : (
          <p>Original expense and allocation facts unavailable.</p>
        )}
        <dl className="grid gap-2 sm:grid-cols-3">
          <div>
            <dt>Expected reimbursement</dt>
            <dd>{reimbursementAmount(item.expectedAmount, item.sourceExpense?.currency)}</dd>
          </div>
          <div>
            <dt>Recorded received amount</dt>
            <dd>{reimbursementAmount(item.receivedAmount, item.sourceExpense?.currency)}</dd>
          </div>
          <div>
            <dt>
              {item.status === "cancelled"
                ? "Cancelled expected remainder"
                : "Remaining expectation"}
            </dt>
            <dd>
              {reimbursementAmount(
                Math.max(0, item.expectedAmount - item.receivedAmount),
                item.sourceExpense?.currency,
              )}
            </dd>
          </div>
        </dl>
        {item.sourceExpense?.personalCostToDate?.state === "qualified" ? (
          <div>
            <p>
              Personal cost to date (whole expense):{" "}
              {reimbursementAmount(
                item.sourceExpense.personalCostToDate.amount,
                item.sourceExpense.personalCostToDate.currency,
              )}
            </p>
            <p className="text-muted-foreground">
              Gross expense less{" "}
              {reimbursementAmount(
                item.sourceExpense.personalCostToDate.receivedAmount,
                item.sourceExpense.personalCostToDate.currency,
              )}{" "}
              in qualifying received reimbursements. Expected recovery is not deducted.
            </p>
            <p className="text-muted-foreground">
              This whole-expense amount can repeat across related claims. Do not add case cards
              together.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">
            Personal net cost unavailable:{" "}
            {item.sourceExpense?.personalCostToDate?.state === "unavailable"
              ? item.sourceExpense.personalCostToDate.reason.replaceAll("_", " ")
              : "the canonical record does not supply it"}
            .
          </p>
        )}
      </section>
      <div className="flex flex-col gap-1">
        <p>{item.dueDate ? `Due date: ${item.dueDate}` : "Due date not recorded"}</p>
        <p>{item.rationale}</p>
        <Evidence evidence={item.evidence} />
      </div>
      {item.matches.length ? (
        <div className="flex flex-col gap-2">
          {item.matches.every((match) => !match.creditTransaction?.currency) ? (
            <p className="text-xs text-muted-foreground">
              Currency is not supplied by this record.
            </p>
          ) : null}
          <ol aria-label="Recorded receipts" className="flex min-w-0 flex-col gap-4">
            {item.matches.map((match, index) => (
              <li key={match.id} className="flex min-w-0 flex-col gap-2">
                <p className="font-medium tabular-nums">
                  Recorded amount:{" "}
                  {match.creditTransaction?.currency
                    ? reimbursementAmount(match.amount, match.creditTransaction.currency)
                    : match.amount.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 20,
                      })}
                </p>
                <p>
                  Match recorded <RecordedTime value={match.createdAt} />
                </p>
                <Link
                  className="w-fit underline underline-offset-4"
                  to={transactionPath(match.creditTransactionId)}
                >
                  Open credit transaction {index + 1}
                </Link>
                {match.creditTransaction ? (
                  <p>
                    Credit transaction date{" "}
                    <time dateTime={match.creditTransaction.date}>
                      {match.creditTransaction.date}
                    </time>{" "}
                    · {match.creditTransaction.merchant} ·{" "}
                    {match.creditTransaction.pending
                      ? "Pending credit, not settled"
                      : "Posted credit"}
                  </p>
                ) : (
                  <p>Credit transaction facts unavailable.</p>
                )}
                {item.sourceExpense?.currency &&
                match.creditTransaction?.currency &&
                item.sourceExpense.currency !== match.creditTransaction.currency ? (
                  <p>
                    Credit currency {match.creditTransaction.currency} differs from expense currency{" "}
                    {item.sourceExpense.currency}; these amounts are not comparable.
                  </p>
                ) : null}
                <p>{match.rationale}</p>
                <Evidence evidence={match.evidence} />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onCorrection("unmatch_credit", match.id)}
                >
                  Remove receipt match {index + 1}
                </Button>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-muted-foreground">No receipts recorded</p>
      )}
      {item.corrections?.length ? (
        <ol aria-label="Recorded reimbursement corrections" className="flex flex-col gap-4">
          {item.corrections.map((correction) => (
            <li key={correction.id} className="flex flex-col gap-2">
              <p>
                {correction.operation === "unmatch_credit"
                  ? "Receipt match removed"
                  : "Expectation corrected"}{" "}
                · <RecordedTime value={correction.recordedAt} />
              </p>
              <p>{correction.rationale}</p>
              <p>
                Expected amount: {reimbursementAmount(correction.previousExpectedAmount, null)} →{" "}
                {reimbursementAmount(correction.expectedAmount, null)}
              </p>
              {correction.removedMatch ? (
                <div>
                  <p>
                    Removed receipt amount:{" "}
                    {reimbursementAmount(
                      correction.removedMatch.amount,
                      correction.removedMatch.creditTransaction?.currency,
                    )}
                  </p>
                  <Link
                    className="underline"
                    to={transactionPath(correction.removedMatch.creditTransactionId)}
                  >
                    Open removed credit transaction
                  </Link>
                  <p>
                    Original match recorded{" "}
                    <RecordedTime value={correction.removedMatch.createdAt} />
                  </p>
                  <p>{correction.removedMatch.rationale}</p>
                  {correction.removedMatch.creditTransaction ? (
                    <p>
                      Removed credit transaction date{" "}
                      <time dateTime={correction.removedMatch.creditTransaction.date}>
                        {correction.removedMatch.creditTransaction.date}
                      </time>{" "}
                      · {correction.removedMatch.creditTransaction.merchant} ·{" "}
                      {correction.removedMatch.creditTransaction.pending
                        ? "Pending credit, not settled"
                        : "Posted credit"}
                    </p>
                  ) : (
                    <p>Removed credit transaction facts unavailable.</p>
                  )}
                  <Evidence evidence={correction.removedMatch.evidence} />
                </div>
              ) : null}
              <Evidence evidence={correction.evidence} />
            </li>
          ))}
        </ol>
      ) : null}
      {item.status === "cancelled" ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium">Expected remainder cancelled</p>
          <p>
            {item.cancelledAt ? (
              <>
                Cancellation recorded <RecordedTime value={item.cancelledAt} />
              </>
            ) : (
              "Cancellation time not recorded"
            )}
          </p>
          {item.cancelledRationale ? <p>{item.cancelledRationale}</p> : null}
          {item.cancelledEvidence ? <Evidence evidence={item.cancelledEvidence} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Inspect and explicitly correct the existing allocation-owned claim and its receipt links. */
export function FinanceReimbursementJourney({
  reimbursement,
  onAccessDenied,
}: {
  reimbursement: FinanceReimbursement;
  onAccessDenied?: () => void;
}) {
  const [selection, setSelection] = useState<{
    reimbursement: FinanceReimbursement;
    operation: "correct_expected" | "unmatch_credit";
    matchId?: string;
  } | null>(null);
  const [denied, setDenied] = useState(false);
  if (denied)
    return (
      <p role="status">
        Reimbursement access unavailable. Check your permissions before viewing receipt evidence.
      </p>
    );
  const correct = (operation: "correct_expected" | "unmatch_credit", matchId?: string) =>
    setSelection({
      reimbursement: structuredClone(reimbursement),
      operation,
      ...(matchId ? { matchId } : {}),
    });
  return (
    <>
      <Collapsible className="min-w-0">
        {reimbursement.status !== "cancelled" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => correct("correct_expected")}
          >
            Correct expectation
          </Button>
        ) : null}
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto min-h-9 max-w-full justify-start whitespace-normal text-left"
          >
            Receipt history and evidence
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <ReceiptEvidence reimbursement={reimbursement} onCorrection={correct} />
        </CollapsibleContent>
      </Collapsible>
      {selection ? (
        <ReimbursementCorrectionDialog
          reimbursement={selection.reimbursement}
          operation={selection.operation}
          {...(selection.matchId ? { matchId: selection.matchId } : {})}
          onClose={() => setSelection(null)}
          onDenied={() => {
            onAccessDenied?.();
            setDenied(true);
            setSelection(null);
          }}
        />
      ) : null}
    </>
  );
}
