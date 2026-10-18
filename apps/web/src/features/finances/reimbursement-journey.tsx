import {
  type FinanceReimbursement,
  type FinanceReimbursementEvidence,
  idSchema,
} from "@personal-os/domain";
import { Link } from "react-router-dom";
import { ChevronDownIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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

function ReceiptEvidence({ reimbursement: item }: { reimbursement: FinanceReimbursement }) {
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
      <div className="flex flex-col gap-1">
        <p>{item.dueDate ? `Due date: ${item.dueDate}` : "Due date not recorded"}</p>
        <p>{item.rationale}</p>
        <Evidence evidence={item.evidence} />
      </div>
      {item.matches.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Currency is not supplied by this record.</p>
          <ol aria-label="Recorded receipts" className="flex min-w-0 flex-col gap-4">
            {item.matches.map((match, index) => (
              <li key={match.id} className="flex min-w-0 flex-col gap-2">
                <p className="font-medium tabular-nums">
                  Recorded amount:{" "}
                  {match.amount.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
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
                <p>{match.rationale}</p>
                <Evidence evidence={match.evidence} />
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-muted-foreground">No receipts recorded</p>
      )}
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

/** Inspect the existing allocation-owned claim; this view never creates or reconciles records. */
export function FinanceReimbursementJourney({
  reimbursement,
}: {
  reimbursement: FinanceReimbursement;
}) {
  return (
    <Collapsible className="min-w-0">
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
        <ReceiptEvidence reimbursement={reimbursement} />
      </CollapsibleContent>
    </Collapsible>
  );
}
