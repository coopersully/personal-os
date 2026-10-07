import type {
  FinanceAccount,
  FinanceAccountKind,
  FinanceAccountOwnershipType,
  UpdateFinanceAccountInput,
} from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ActionButton as Button } from "@/components/action-button";
import { CurrencyInput } from "@/components/currency-input";
import { HistoryIcon } from "@/components/icons";
import { MutationFeedback } from "@/components/mutation-feedback";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemGroup } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import { api } from "../../api.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { financeAccountNeedsConnectionAttention } from "./attention";
import {
  isConfirmedFinanceMutationFailure,
  requireFinanceMutationResult,
} from "./mutation-retry.js";
import { PlaidConnectButton } from "./plaid-connect";
import {
  FinanceAccountRecord,
  FinanceSourceState,
  refreshFinancePosition,
} from "./position-material.js";
import { FinanceCreateButton } from "./workspace-header";

export function FinanceAccountsPage() {
  const client = useQueryClient();
  const health = useQuery({
    queryKey: ["finance-ledger-health"],
    queryFn: () => api.getFinanceLedgerHealth(),
  });
  const sync = useFeedbackMutation({
    feedback: { action: "sync this account", safeToRetry: true },
    mutationFn: (id: string) => api.syncFinanceAccount(id),
    onSuccess: () => refreshFinancePosition(client),
  });
  const accounts = useQuery({
    queryKey: ["finance-accounts"],
    queryFn: () => api.listFinanceAccounts(),
  });
  const [editing, setEditing] = useState<FinanceAccount | null>(null);
  return (
    <div className="flex flex-col gap-5">
      <WorkspaceHeaderControls label="Account controls">
        <Button
          asChild
          size="icon"
          variant="ghost"
          aria-label="Import records"
          title="Import records"
        >
          <Link to="/finances/imports">
            <HistoryIcon />
          </Link>
        </Button>
      </WorkspaceHeaderControls>
      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardAction>
            <FinanceCreateButton kind="account" />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FinanceSourceState label="Accounts" query={accounts} />
          {accounts.data ? (
            <>
              <MutationFeedback feedback={sync.feedback} />
              {health.isError ? (
                <Alert variant="warning">
                  <AlertTitle>Account coverage could not load</AlertTitle>
                  <AlertDescription>
                    <Button variant="outline" onClick={() => void health.refetch()}>
                      Retry account coverage
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}
              {health.data ? (
                <p className="text-sm text-muted-foreground">
                  {health.data.balanceOnlyAccounts} balance-only{" "}
                  {health.data.balanceOnlyAccounts === 1 ? "account" : "accounts"} · Balances are
                  tracked without transaction history.
                </p>
              ) : null}
              {accounts.data.accounts.length ? (
                <ItemGroup aria-label="Financial accounts" className="finance-account-grid">
                  {accounts.data.accounts.map((account) => {
                    const duplicateIds = new Set(
                      accounts.data.accountSemantics.possibleDuplicateGroups
                        .filter((group) => group.accountIds.includes(account.id))
                        .flatMap((group) => group.accountIds),
                    );
                    const duplicateNames = accounts.data.accounts
                      .filter((other) => other.id !== account.id && duplicateIds.has(other.id))
                      .map((other) => other.name);
                    return (
                      <div key={account.id} className="grid min-w-0 gap-3">
                        <FinanceAccountRecord
                          account={account}
                          duplicateNames={duplicateNames}
                          key={account.id}
                          onEdit={() => setEditing(account)}
                          attentionAction={
                            financeAccountNeedsConnectionAttention(account) ? (
                              account.status === "needs_reauth" ? (
                                <PlaidConnectButton
                                  label="Reconnect bank"
                                  onConnected={() => refreshFinancePosition(client)}
                                />
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={sync.isPending}
                                  onClick={() => sync.mutate(account.id)}
                                >
                                  Sync account
                                </Button>
                              )
                            ) : undefined
                          }
                        />
                      </div>
                    );
                  })}
                </ItemGroup>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No accounts tracked</EmptyTitle>
                    <EmptyDescription>
                      Connect a bank, import records, or track an account manually.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
      {editing ? (
        <AccountEditor
          account={editing}
          key={`${editing.id}:${editing.updatedAt}`}
          onClose={() => setEditing(null)}
          onReload={async () => {
            const result = await accounts.refetch();
            const latest = result.data?.accounts.find((item) => item.id === editing.id);
            if (latest) setEditing(latest);
          }}
        />
      ) : null}
    </div>
  );
}

function AccountKindField({
  value,
  onChange,
}: {
  value: FinanceAccountKind;
  onChange: (kind: FinanceAccountKind) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="account-kind">Account kind</FieldLabel>
      <NativeSelect
        name="kind"
        id="account-kind"
        onChange={(event) => onChange(event.target.value as FinanceAccountKind)}
        value={value}
      >
        <NativeSelectOption value="cash">Cash</NativeSelectOption>
        <NativeSelectOption value="investment">Investments</NativeSelectOption>
        <NativeSelectOption value="debt">Debt</NativeSelectOption>
        <NativeSelectOption value="other">Other assets</NativeSelectOption>
      </NativeSelect>
    </Field>
  );
}

function AccountEditor({
  account,
  onClose,
  onReload,
}: {
  account: FinanceAccount;
  onClose: () => void;
  onReload: () => Promise<void>;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(account.name);
  const [institution, setInstitution] = useState(account.institution);
  const [kind, setKind] = useState(account.kind);
  const [ownership, setOwnership] = useState(account.ownershipType);
  const [share, setShare] = useState(
    account.ownershipShare === null ? "" : String(account.ownershipShare * 100),
  );
  const [included, setIncluded] = useState(account.includeInPlanning);
  const [balance, setBalance] = useState(account.balance === null ? "" : String(account.balance));
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const lastAttempt = useRef<{ payload: string; key: string } | null>(null);
  const disconnectKey = useRef<string | null>(null);
  const ownershipShare =
    ownership === "individual" ? 1 : ownership === "unknown" ? null : Number(share) / 100;
  const manualBalance = balance.trim() === "" ? null : Number(balance);
  const changes = {
    expectedUpdatedAt: account.updatedAt,
    ...(included !== account.includeInPlanning ? { includeInPlanning: included } : {}),
    ...(institution.trim() !== account.institution ? { institution: institution.trim() } : {}),
    ...(kind !== account.kind ? { kind } : {}),
    ...(name.trim() !== account.name ? { name: name.trim() } : {}),
    ...(ownership !== account.ownershipType || ownershipShare !== account.ownershipShare
      ? { ownershipType: ownership, ownershipShare }
      : {}),
    ...(account.provider === "manual" && manualBalance !== account.balance
      ? { balance: manualBalance }
      : {}),
  };
  const hasChanges = Object.keys(changes).length > 1;
  const save = useFeedbackMutation({
    feedback: { action: "save this account", safeToRetry: false, form: true },
    mutationFn: async () => {
      const payload = JSON.stringify(changes);
      if (lastAttempt.current?.payload !== payload)
        lastAttempt.current = { payload, key: crypto.randomUUID() };
      const input: UpdateFinanceAccountInput = {
        ...changes,
        idempotencyKey: lastAttempt.current.key,
      };
      return requireFinanceMutationResult(await api.updateFinanceAccount(account.id, input));
    },
    onError: (error) => {
      if (isConfirmedFinanceMutationFailure(error)) lastAttempt.current = null;
      void refreshFinancePosition(client);
    },
    onSuccess: async () => {
      await refreshFinancePosition(client);
      onClose();
    },
  });
  const disconnect = useFeedbackMutation({
    feedback: { action: "disconnect this account", safeToRetry: false, form: false },
    mutationFn: async () => {
      disconnectKey.current ??= crypto.randomUUID();
      return requireFinanceMutationResult(
        await api.disconnectFinanceAccount(account.id, {
          idempotencyKey: disconnectKey.current,
        }),
      );
    },
    onError: (error) => {
      if (isConfirmedFinanceMutationFailure(error)) disconnectKey.current = null;
      void refreshFinancePosition(client);
    },
    onSuccess: async () => {
      await refreshFinancePosition(client);
      onClose();
    },
  });
  const canDisconnect =
    account.provider === "plaid" &&
    account.synchronization.failureCode !== "finance_account_disconnected" &&
    account.synchronization.failureCode !== "finance_account_legacy_disconnected";
  const validShare =
    ownership !== "joint" ||
    (share.trim() !== "" &&
      Number.isFinite(Number(share)) &&
      Number(share) > 0 &&
      Number(share) <= 100);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending && !disconnect.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit account</DialogTitle>
          <DialogDescription>
            Correct how {account.name} contributes to your financial position.
          </DialogDescription>
        </DialogHeader>
        <FeedbackForm
          feedback={save.feedback}
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (validShare && hasChanges) save.mutate();
          }}
        >
          <FieldSet disabled={save.isPending}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="account-name">Account name</FieldLabel>
                <Input
                  name="name"
                  id="account-name"
                  maxLength={160}
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="account-institution">Institution</FieldLabel>
                <Input
                  name="institution"
                  id="account-institution"
                  maxLength={160}
                  onChange={(event) => setInstitution(event.target.value)}
                  required
                  value={institution}
                />
              </Field>
              <AccountKindField onChange={setKind} value={kind} />
              <Field>
                <FieldLabel htmlFor="account-ownership">Ownership</FieldLabel>
                <NativeSelect
                  name="ownershipType"
                  id="account-ownership"
                  onChange={(event) =>
                    setOwnership(event.target.value as FinanceAccountOwnershipType)
                  }
                  value={ownership}
                >
                  <NativeSelectOption value="unknown">Needs confirmation</NativeSelectOption>
                  <NativeSelectOption value="individual">Individual</NativeSelectOption>
                  <NativeSelectOption value="joint">Joint</NativeSelectOption>
                </NativeSelect>
              </Field>
              {ownership === "joint" ? (
                <Field>
                  <FieldLabel htmlFor="account-share">Your ownership share (%)</FieldLabel>
                  <Input
                    name="ownershipShare"
                    id="account-share"
                    min="0.01"
                    max="100"
                    step="0.01"
                    type="number"
                    required
                    value={share}
                    onChange={(event) => setShare(event.target.value)}
                  />
                  <FieldDescription>
                    Only this share contributes to your personal position.
                  </FieldDescription>
                </Field>
              ) : null}
              <Field orientation="horizontal">
                <Checkbox
                  checked={included}
                  id="account-included"
                  onCheckedChange={(checked) => setIncluded(checked === true)}
                />
                <FieldLabel htmlFor="account-included">Include in planning</FieldLabel>
              </Field>
              {account.provider === "manual" ? (
                <Field>
                  <FieldLabel htmlFor="account-balance">Balance</FieldLabel>
                  <CurrencyInput
                    name="balance"
                    id="account-balance"
                    currencyCode={account.currencyCode}
                    min={Number.NEGATIVE_INFINITY}
                    value={balance}
                    onValueChange={setBalance}
                  />
                  <FieldDescription>Leave blank when the balance is unavailable.</FieldDescription>
                </Field>
              ) : null}
            </FieldGroup>
          </FieldSet>

          {save.feedback?.kind === "conflict" ? (
            <Button onClick={() => void onReload()} size="sm" type="button" variant="outline">
              Reload account
            </Button>
          ) : null}
          <DialogFooter>
            {canDisconnect ? (
              <Button
                disabled={save.isPending || disconnect.isPending}
                onClick={() => setConfirmingDisconnect(true)}
                type="button"
                variant="destructive"
              >
                Stop tracking account
              </Button>
            ) : null}
            <Button
              disabled={save.isPending || disconnect.isPending}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={save.isPending || !hasChanges} type="submit">
              {save.isPending ? "Saving account…" : "Save account"}
            </Button>
          </DialogFooter>
        </FeedbackForm>
        <Dialog
          open={confirmingDisconnect}
          onOpenChange={(open) => {
            if (!disconnect.isPending) setConfirmingDisconnect(open);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Stop tracking {account.name}?</DialogTitle>
              <DialogDescription>
                nohmi will stop using this account locally and keep its ledger history. Other
                accounts at this institution stay connected, so Plaid may continue sending this
                account's data through their shared connection. This does not revoke access at your
                institution. Reconnecting later requires your consent.
              </DialogDescription>
            </DialogHeader>
            {disconnect.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Account is still tracked</AlertTitle>
                <AlertDescription>{disconnect.feedback?.message}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button
                disabled={disconnect.isPending}
                onClick={() => setConfirmingDisconnect(false)}
                type="button"
                variant="outline"
              >
                Keep connected
              </Button>
              <Button
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
                type="button"
                variant="destructive"
              >
                {disconnect.isPending ? "Stopping…" : "Stop tracking account"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

export function ManualAccountEditor({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [kind, setKind] = useState<FinanceAccountKind>("cash");
  const [balance, setBalance] = useState("");
  const create = useFeedbackMutation({
    feedback: { action: "create this account", safeToRetry: false, form: true },
    mutationFn: () =>
      api.createFinanceAccount({
        balance: balance.trim() === "" ? null : Number(balance),
        institution: institution.trim(),
        kind,
        name: name.trim(),
        provider: "manual",
      }),
    onSuccess: async () => {
      await refreshFinancePosition(client);
      onClose();
    },
  });
  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose();
      }}
    >
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Track account manually</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Record a balance you maintain yourself.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <FeedbackForm
          feedback={create.feedback}
          className="flex min-h-0 flex-col gap-5 overflow-hidden"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <ResponsiveDialogBody>
            <FieldSet disabled={create.isPending}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="new-account-name">Account name</FieldLabel>
                  <Input
                    name="name"
                    id="new-account-name"
                    maxLength={160}
                    onChange={(event) => setName(event.target.value)}
                    required
                    value={name}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="new-account-institution">Institution</FieldLabel>
                  <Input
                    name="institution"
                    id="new-account-institution"
                    maxLength={160}
                    onChange={(event) => setInstitution(event.target.value)}
                    required
                    value={institution}
                  />
                </Field>
                <AccountKindField value={kind} onChange={setKind} />
                <Field>
                  <FieldLabel htmlFor="new-account-balance">Balance</FieldLabel>
                  <CurrencyInput
                    name="balance"
                    id="new-account-balance"
                    min={Number.NEGATIVE_INFINITY}
                    value={balance}
                    onValueChange={setBalance}
                  />
                  <FieldDescription>Leave blank when the balance is unavailable.</FieldDescription>
                </Field>
              </FieldGroup>
            </FieldSet>
          </ResponsiveDialogBody>

          <ResponsiveDialogFooter className="flex-row justify-end">
            <Button disabled={create.isPending} onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={create.isPending} type="submit">
              {create.isPending ? "Adding account…" : "Add account"}
            </Button>
          </ResponsiveDialogFooter>
        </FeedbackForm>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
