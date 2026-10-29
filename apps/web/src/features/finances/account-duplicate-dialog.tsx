import type { FinanceAccount, FinanceAccountDuplicatePreview } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ActionButton as Button } from "@/components/action-button";
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogBody as DialogBody,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
} from "@/components/responsive-dialog";
import { Field, FieldLabel } from "@/components/settings-field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api } from "../../api.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import {
  isConfirmedFinanceMutationFailure,
  requireFinanceMutationResult,
} from "./mutation-retry.js";
import { financeObservedAt, refreshFinancePosition } from "./position-material.js";

function AccountIdentity({
  account,
  label,
  count,
}: {
  account: FinanceAccount;
  label: string;
  count: number;
}) {
  return (
    <section aria-label={label} className="min-w-0 space-y-1">
      <h3 className="font-medium">
        {label}: {account.name}
      </h3>
      <p className="text-sm break-words">
        {account.institution} ·{" "}
        {account.accountMask ? `Ending in ${account.accountMask}` : "Account number unavailable"}
      </p>
      <p className="text-sm text-muted-foreground">Added {financeObservedAt(account.createdAt)}</p>
      <p className="text-sm text-muted-foreground">
        Last synced {account.lastSyncedAt ? financeObservedAt(account.lastSyncedAt) : "never"} ·{" "}
        {account.synchronization.state}
      </p>
      <p className="text-sm">{count} recorded transactions</p>
    </section>
  );
}

export function AccountDuplicateDialog({
  account,
  candidates,
  onClose,
}: {
  account: FinanceAccount;
  candidates: FinanceAccount[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [keepAccountId, setKeepAccountId] = useState("");
  const [preview, setPreview] = useState<FinanceAccountDuplicatePreview | null>(null);
  const attempt = useRef<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const eligible = candidates.filter(
    (candidate) =>
      candidate.id !== account.id &&
      candidate.provider === "plaid" &&
      candidate.status === "connected" &&
      candidate.synchronization.state === "current",
  );
  const compare = useFeedbackMutation({
    feedback: {
      action: "compare these accounts",
      safeToRetry: true,
      pending: "Comparing accounts…",
      success: "Account comparison ready.",
    },
    mutationFn: async () =>
      requireFinanceMutationResult(
        await api.getFinanceAccountDuplicatePreview(account.id, keepAccountId),
      ),
    onSuccess: (result) => {
      setPreview(result.data);
      attempt.current = null;
      cancel.current?.focus();
    },
  });
  const resolve = useFeedbackMutation({
    feedback: {
      action: "stop tracking the duplicate",
      safeToRetry: false,
      pending: "Stopping duplicate tracking…",
      success: "Duplicate tracking stopped. Transaction history preserved.",
    },
    mutationFn: async () => {
      if (!preview) throw new Error("Compare these accounts before continuing.");
      attempt.current ??= crypto.randomUUID();
      return requireFinanceMutationResult(
        await api.resolveFinanceAccountDuplicate(account.id, {
          keepAccountId: preview.keptAccount.id,
          revision: preview.revision,
          idempotencyKey: attempt.current,
        }),
      );
    },
    onError: (error) => {
      if (isConfirmedFinanceMutationFailure(error)) {
        attempt.current = null;
        setPreview(null);
      }
      void refreshFinancePosition(client);
    },
    onSuccess: async () => {
      await refreshFinancePosition(client);
      onClose();
    },
  });
  const pending = compare.isPending || resolve.isPending;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        data-finance-dialog
        data-finance-size="default"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Compare duplicates</DialogTitle>
          <DialogDescription>
            Choose the account to keep tracking, then review before stopping local tracking of{" "}
            {account.name}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="min-w-0 w-full max-w-full space-y-5 [&>*]:min-w-0 [&>*]:max-w-full">
          <Field>
            <FieldLabel htmlFor="duplicate-keep-account">Account to keep tracking</FieldLabel>
            <NativeSelect
              id="duplicate-keep-account"
              value={keepAccountId}
              disabled={pending || Boolean(attempt.current)}
              onChange={(event) => {
                setKeepAccountId(event.target.value);
                setPreview(null);
                compare.reset();
                resolve.reset();
              }}
            >
              <NativeSelectOption value="">Choose an account</NativeSelectOption>
              {eligible.map((candidate) => (
                <NativeSelectOption key={candidate.id} value={candidate.id}>
                  {candidate.name} ·{" "}
                  {candidate.accountMask
                    ? `Ending in ${candidate.accountMask}`
                    : candidate.institution}{" "}
                  · Added {financeObservedAt(candidate.createdAt)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {!eligible.length ? (
            <p className="text-sm text-muted-foreground">
              A connected account with current synchronization is required. Reconnect or sync the
              account you want to keep first.
            </p>
          ) : null}
          {preview ? (
            <>
              <AccountIdentity
                account={preview.keptAccount}
                label="Keep tracking"
                count={preview.keptTransactionCount}
              />
              <AccountIdentity
                account={preview.redundantAccount}
                label="Stop tracking"
                count={preview.redundantTransactionCount}
              />
              <p className="text-sm">
                {preview.match === "provider_identity"
                  ? "These accounts have matching provider details. Confirm they represent the same account."
                  : "These accounts may be duplicates. Confirm they represent the same account."}
              </p>
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-sm">
                <dt>Overlapping transactions</dt>
                <dd>{preview.overlappingTransactionCount}</dd>
                <dt>Unique transactions on the redundant account</dt>
                <dd>{preview.uniqueRedundantTransactionCount}</dd>
              </dl>
              <p className="text-sm">
                Stopping tracking excludes {preview.redundantAccount.name} from planning and stops
                its local updates. All transaction history stays on its original account;
                transactions are not automatically merged into the kept account. Unique transactions
                remain visible on the redundant account but are excluded from planning, which can
                change past spending totals.
              </p>
              <p className="text-sm text-muted-foreground">
                This does not revoke provider access or cancel any billing or subscriptions. Other
                accounts on the shared connection stay connected.
              </p>
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {preview ? (
            <Button variant="destructive" disabled={pending} onClick={() => resolve.mutate()}>
              Stop tracking duplicate
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={pending || !eligible.some((candidate) => candidate.id === keepAccountId)}
              onClick={() => compare.mutate()}
            >
              {resolve.isError ? "Reload comparison" : "Preview comparison"}
            </Button>
          )}
          <Button ref={cancel} disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
