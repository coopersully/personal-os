import type {
  FinanceAccount,
  FinanceAccountKind,
  FinanceAccountOwnershipType,
  UpdateFinanceAccountInput,
} from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import {
  WorkspaceSecondaryAppBar,
  WorkspaceSecondaryAppBarActions,
} from "@/components/workspace-secondary-app-bar";
import { api, errorMessage } from "../../api.js";
import {
  isConfirmedFinanceMutationFailure,
  requireFinanceMutationResult,
} from "./mutation-retry.js";
import { PlaidConnectButton } from "./plaid-connect.js";
import {
  FinanceAccountRecord,
  FinanceSourceState,
  refreshFinancePosition,
} from "./position-material.js";

export function FinanceAccountsPage() {
  const client = useQueryClient();
  const accounts = useQuery({
    queryKey: ["finance-accounts"],
    queryFn: () => api.listFinanceAccounts(),
  });
  const [editing, setEditing] = useState<FinanceAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const refresh = () => refreshFinancePosition(client);
  return (
    <div className="flex flex-col gap-5">
      <WorkspaceSecondaryAppBar aria-label="Account controls">
        <WorkspaceSecondaryAppBarActions>
          <PlaidConnectButton onConnected={refresh} />
          <Button onClick={() => setCreating(true)} size="sm" variant="outline">
            Track account manually
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/finances/imports">Import records</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/finances/health">Evidence health</Link>
          </Button>
        </WorkspaceSecondaryAppBarActions>
      </WorkspaceSecondaryAppBar>
      <FinanceSourceState label="Accounts" query={accounts} />
      {accounts.data ? (
        <>
          {!accounts.data.accountSemantics.trustworthy ? (
            <Alert>
              <AlertTitle>Account interpretation needs attention</AlertTitle>
              <AlertDescription>
                Confirm ownership and possible duplicates before relying on your personal position.
                Excluding an account removes it from planning.
              </AlertDescription>
            </Alert>
          ) : null}
          {accounts.data.accounts.length ? (
            <ItemGroup aria-label="Financial accounts">
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
                  <FinanceAccountRecord
                    account={account}
                    duplicateNames={duplicateNames}
                    key={account.id}
                    onEdit={() => setEditing(account)}
                  />
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
      {creating ? <ManualAccountEditor onClose={() => setCreating(false)} /> : null}
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
  const lastAttempt = useRef<{ payload: string; key: string } | null>(null);
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
  const save = useMutation({
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
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit account</DialogTitle>
          <DialogDescription>
            Correct how {account.name} contributes to your financial position.
          </DialogDescription>
        </DialogHeader>
        <form
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
                <Field data-invalid={!validShare}>
                  <FieldLabel htmlFor="account-share">Your ownership share (%)</FieldLabel>
                  <Input
                    aria-invalid={!validShare}
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
                  <Input
                    id="account-balance"
                    type="number"
                    step="0.01"
                    value={balance}
                    onChange={(event) => setBalance(event.target.value)}
                  />
                  <FieldDescription>Leave blank when the balance is unavailable.</FieldDescription>
                </Field>
              ) : null}
            </FieldGroup>
          </FieldSet>
          {save.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Account was not saved</AlertTitle>
              <AlertDescription>
                <p>{errorMessage(save.error)}</p>
                <Button onClick={() => void onReload()} size="sm" type="button" variant="outline">
                  Reload account
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button disabled={save.isPending} onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={
                save.isPending || !hasChanges || !validShare || !name.trim() || !institution.trim()
              }
              type="submit"
            >
              {save.isPending ? "Saving account…" : "Save account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManualAccountEditor({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [kind, setKind] = useState<FinanceAccountKind>("cash");
  const [balance, setBalance] = useState("");
  const create = useMutation({
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Track account manually</DialogTitle>
          <DialogDescription>Record a balance you maintain yourself.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <FieldSet disabled={create.isPending}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="new-account-name">Account name</FieldLabel>
                <Input
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
                <Input
                  id="new-account-balance"
                  type="number"
                  step="0.01"
                  value={balance}
                  onChange={(event) => setBalance(event.target.value)}
                />
                <FieldDescription>Leave blank when the balance is unavailable.</FieldDescription>
              </Field>
            </FieldGroup>
          </FieldSet>
          {create.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Account was not added</AlertTitle>
              <AlertDescription>{errorMessage(create.error)}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button disabled={create.isPending} onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={create.isPending || !name.trim() || !institution.trim()}
              type="submit"
            >
              {create.isPending ? "Adding account…" : "Add account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
