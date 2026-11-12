import type { FinanceOpeningPosition } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DataViewRecovery } from "@/components/data-view-state";
import { Field, FieldLabel } from "@/components/settings-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "../../api.js";
import { FinanceSection } from "./finance-section";
import { formatMoney } from "./format";

type Account = FinanceOpeningPosition["accounts"][number];
export function FinanceOpeningPositionPanel({
  sessionKey,
  isCurrent,
}: {
  sessionKey: string;
  isCurrent: () => boolean;
}) {
  const attention = useQuery({
    queryKey: ["finance-attention", sessionKey],
    queryFn: () => api.getFinanceAttention(),
  });
  const month = attention.data?.period;
  const position = useQuery({
    queryKey: ["finance-opening-position", sessionKey, month],
    enabled: !!month,
    queryFn: () => {
      if (!month) throw new Error("Month unavailable");
      return api.getFinanceOpeningPosition(month);
    },
  });
  const [selected, setSelected] = useState<{
    account: Account;
    position: FinanceOpeningPosition;
  } | null>(null);
  return (
    <FinanceSection title="Starting balances">
      <DataViewRecovery
        query={attention}
        title="Could not load budget month"
        unavailableLabel="Budget month unavailable"
      />
      <DataViewRecovery
        query={position}
        title="Could not load starting balances"
        unavailableLabel="Starting balances unavailable"
      />
      <p className="text-sm text-muted-foreground">
        Use statement balances at the start of the month. Today’s balance is not a starting balance.
      </p>
      {selected ? (
        <StatementEditor
          key={`${sessionKey}:${selected.account.accountId}`}
          {...selected}
          sessionKey={sessionKey}
          isCurrent={isCurrent}
          onDone={() => setSelected(null)}
        />
      ) : (
        <ul className="grid gap-2">
          {position.data?.accounts.map((account) => (
            <li key={account.accountId}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-between gap-4 py-3"
                disabled={account.currencyCode !== "USD" || position.isError}
                onClick={() => {
                  if (position.data) setSelected({ account, position: position.data });
                }}
              >
                <span className="min-w-0 text-left">{account.name}</span>
                <span>
                  {account.openingBalanceCents === null
                    ? "Needs evidence"
                    : formatMoney(account.openingBalanceCents / 100)}
                </span>
              </Button>
              {account.reasons.length ? (
                <p className="text-sm text-muted-foreground">
                  {account.reasons.map((reason) => reason.replaceAll("_", " ")).join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </FinanceSection>
  );
}
function StatementEditor({
  account,
  position,
  sessionKey,
  isCurrent,
  onDone,
}: {
  account: Account;
  position: FinanceOpeningPosition;
  sessionKey: string;
  isCurrent: () => boolean;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const existing = position.statements
    .filter((item) => item.accountId === account.accountId && item.month === position.month)
    .sort((a, b) => b.revision - a.revision)[0];
  const [value, setValue] = useState(
    existing ? String(existing.signedOpeningBalanceCents / 100) : "",
  );
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  const attempt = useRef<{ value: string; key: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const cents = Math.round(Number(value) * 100);
  const valid =
    /^-?\d+(\.\d{1,2})?$/.test(value.trim()) &&
    Number.isSafeInteger(cents) &&
    Math.abs(cents) <= 10000000000;
  async function save() {
    const live = () => mounted.current && isCurrent();
    if (!edited || !valid || busy.current || !live()) return;
    busy.current = true;
    setPending(true);
    if (attempt.current?.value !== value) attempt.current = { value, key: crypto.randomUUID() };
    const feedback = toast.loading("Recording opening statement…");
    try {
      const receipt = await api.confirmFinanceOpeningStatement({
        accountId: account.accountId,
        month: position.month,
        expectedAccountRevision: account.accountRevision,
        expectedStatementRevision: existing?.revision ?? 0,
        signedOpeningBalanceCents: cents,
        idempotencyKey: attempt.current.key,
      });
      if (
        receipt.accountId !== account.accountId ||
        receipt.month !== position.month ||
        receipt.signedOpeningBalanceCents !== cents
      )
        throw new Error("Statement not confirmed");
      if (live()) {
        toast.success("Opening statement recorded", { id: feedback });
        void client.invalidateQueries({ queryKey: ["finance-opening-position", sessionKey] });
        void client.invalidateQueries({ queryKey: ["finance-attention", sessionKey] });
        void client.invalidateQueries({ queryKey: ["finance-review-backlog"] });
        onDone();
      } else toast.dismiss(feedback);
    } catch {
      if (live())
        toast.error(
          "Could not confirm the statement. Your entry is kept; check the current account before retrying.",
          { id: feedback },
        );
      else toast.dismiss(feedback);
    } finally {
      busy.current = false;
      if (live()) setPending(false);
    }
  }
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p>
        {account.name} ·{" "}
        {new Date(`${position.month}-01T12:00:00Z`).toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })}
      </p>
      <Field>
        <FieldLabel htmlFor="opening-balance">Opening balance in USD</FieldLabel>
        <div className="flex items-center gap-2">
          <span>$</span>
          <Input
            id="opening-balance"
            inputMode="decimal"
            value={value}
            disabled={pending}
            onChange={(event) => {
              setValue(event.target.value);
              setEdited(true);
            }}
            placeholder="1250.50"
            aria-invalid={edited && !valid}
          />
        </div>
      </Field>
      <p className="text-sm text-muted-foreground">
        Use a negative amount for money owed. Your current account balance stays unchanged.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={onDone}>
          {edited ? "Cancel" : "Close"}
        </Button>
        <Button type="submit" disabled={!edited || !valid || pending}>
          Confirm opening balance
        </Button>
      </div>
    </form>
  );
}
