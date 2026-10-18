import type { FinanceCashflowProjectionView, FinanceIncomeStream } from "@personal-os/domain";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface PaydayViewProps {
  view: FinanceCashflowProjectionView | null;
  incomeStreams: Pick<FinanceIncomeStream, "id" | "displayName">[];
  selectedIncomeStreamId: string | null;
  onIncomeStreamChange: (id: string | null) => void;
  onConfirmSchedule: () => void;
  onReviewActuals: () => void;
  onConfirmBalance: () => void;
  onRefresh: () => void;
}
const explanations: Record<string, string> = {
  balance_basis_unavailable: "A current balance statement is missing or no longer applicable.",
  actual_review_required: "Actual movements need explicit balance-reflection review.",
  unconfirmed_schedule: "Confirm a recurring schedule before using its expected dates.",
  unknown_amount: "A variable or unknown amount cannot establish this cycle estimate.",
  next_payday_unavailable: "The selected income stream has no qualified next payday.",
  income_selection_required: "Choose the income stream that defines this cycle.",
  stale_balance: "The balance statement is outside its explicit validity interval.",
  unknown_reflection: "A movement's inclusion in the balance is unknown.",
  invalid_floor: "The optional protected-floor statement needs review.",
};
export function PaydayView({
  view,
  incomeStreams,
  selectedIncomeStreamId,
  onIncomeStreamChange,
  onConfirmSchedule,
  onReviewActuals,
  onConfirmBalance,
  onRefresh,
}: PaydayViewProps) {
  const id = useId();
  const [page, setPage] = useState(0);
  const projection = view?.projection;
  const qualified =
    projection?.status === "estimated" &&
    projection.selectedIncomeStreamId === selectedIncomeStreamId
      ? projection
      : null;
  const money = (amount: number) =>
    qualified
      ? new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: qualified.currencyCode,
        }).format(amount / 100)
      : "Unavailable";
  const pageCount = qualified ? Math.max(1, Math.ceil(qualified.days.length / 24)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  return (
    <section aria-label="Payday-to-payday" className="flex flex-col gap-4">
      <h2 className="font-semibold">Payday-to-payday</h2>
      <Field>
        <FieldLabel htmlFor={`${id}-selected-income`}>Income stream defining this cycle</FieldLabel>
        <NativeSelect
          id={`${id}-selected-income`}
          value={selectedIncomeStreamId ?? ""}
          onChange={(event) => {
            setPage(0);
            onIncomeStreamChange(event.target.value || null);
          }}
        >
          <NativeSelectOption value="">Choose an income stream</NativeSelectOption>
          {incomeStreams.map((stream) => (
            <NativeSelectOption key={stream.id} value={stream.id}>
              {stream.displayName}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onConfirmSchedule}>
          Confirm recurring schedule
        </Button>
        <Button variant="secondary" onClick={onReviewActuals}>
          Review actual matches
        </Button>
        <Button variant="secondary" onClick={onConfirmBalance}>
          Confirm balance and reflections
        </Button>
        <Button variant="ghost" onClick={onRefresh}>
          Refresh cycle evidence
        </Button>
      </div>
      {!selectedIncomeStreamId ? (
        <p>
          Choose the income source explicitly. Multiple income streams never select a payday
          automatically.
        </p>
      ) : !projection ? (
        <p>Cycle evidence has not been loaded. Refresh after choosing a source.</p>
      ) : null}
      {projection?.status === "unavailable" ? (
        <ul aria-label="Unavailable cycle evidence">
          {projection.reasons.map((reason) => (
            <li key={`${reason.code}:${reason.evidenceId}`}>
              {explanations[reason.code] ??
                "Some cycle evidence is incomplete or inconsistent. Review schedules, actual movements and balance statements."}
              {reason.evidenceId ? ` · Source ${reason.evidenceId}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {projection?.status === "estimated" && !qualified ? (
        <p>The loaded estimate belongs to another income source. Refresh this selected cycle.</p>
      ) : null}
      {qualified ? (
        <>
          <p>
            Estimated cycle through {qualified.endLocalDate}, as of {qualified.asOfLocalDate}. The
            ending estimate includes {money(qualified.expectedEndPaydayIncomeMinorUnits)} of
            expected end-payday income, not a confirmed receipt.
          </p>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt>Opening stated balance</dt>
              <dd>{money(qualified.openingBalanceMinorUnits)}</dd>
            </div>
            <div>
              <dt>Estimated ending balance</dt>
              <dd>{money(qualified.endingBalanceMinorUnits)}</dd>
            </div>
            <div>
              <dt>Lowest stated or end-of-day estimate</dt>
              <dd>
                {money(qualified.lowestEndOfDayBalance.amountMinorUnits)} ·{" "}
                {qualified.lowestEndOfDayBalance.localDate} ·{" "}
                {qualified.lowestEndOfDayBalance.basis === "opening"
                  ? "Opening statement"
                  : "End of day"}
              </dd>
            </div>
          </dl>
          <p>
            Same-day incoming and outgoing movements are aggregated at end of day. Their intraday
            order and any intraday low are unknown. These estimates are not a safe-to-spend amount.
          </p>
          <p>
            {qualified.protectedFloor.status === "unknown"
              ? "Protected floor unknown. No zero floor or affordability is assumed; a floor is optional."
              : `User-confirmed floor ${money(qualified.protectedFloor.amountMinorUnits)}. Lowest stated/end-of-day margin ${money(qualified.protectedFloor.lowestEndOfDayMarginMinorUnits)}; this is not an intraday affordability guarantee.`}
          </p>
          <Table aria-label="Estimated cycle movements">
            <TableHeader>
              <TableRow>
                <TableHead>Local date</TableHead>
                <TableHead>Expected incoming</TableHead>
                <TableHead>Expected outgoing</TableHead>
                <TableHead>Actual not reflected in basis</TableHead>
                <TableHead>Estimated end-of-day balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {qualified.days.slice(currentPage * 24, (currentPage + 1) * 24).map((day) => (
                <TableRow key={day.localDate}>
                  <TableCell>{day.localDate}</TableCell>
                  <TableCell>{money(day.expectedIncomingMinorUnits)}</TableCell>
                  <TableCell>{money(day.expectedOutgoingMinorUnits)}</TableCell>
                  <TableCell>{money(day.unreflectedActualNetMinorUnits)}</TableCell>
                  <TableCell>{money(day.estimatedEndOfDayBalanceMinorUnits)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p>
            Cycle movement page {currentPage + 1} of {pageCount}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous cycle movements
            </Button>
            <Button
              variant="ghost"
              disabled={currentPage + 1 === pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Next cycle movements
            </Button>
          </div>
          <details>
            <summary>Cycle source evidence</summary>
            <ul>
              {qualified.evidence.balances.map((basis) => (
                <li key={basis.accountId}>
                  Account {basis.accountId} · {basis.basis} · revision {basis.sourceRevision} ·
                  stated {basis.asOfInstant} · valid until {basis.validUntilInstant}
                </li>
              ))}
            </ul>
            <p>
              {qualified.evidence.occurrences.length} scheduled occurrence revisions;{" "}
              {qualified.evidence.actualMovements.length} actual movement revisions.
            </p>
          </details>
        </>
      ) : null}
      {view?.schedule.unavailableSources.length ? (
        <p>
          Some recurring sources have unavailable dates or amounts. Confirm their current schedules
          or review variable amounts.
        </p>
      ) : null}
    </section>
  );
}
