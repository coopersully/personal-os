import type { FinanceAccount } from "@personal-os/domain";
import { type ReactNode, useId } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ActionButton as Button } from "@/components/action-button";
import { type DataColumn, DataTable, DataTableActions } from "@/components/data-table";
import { DataChoice, FilterBar, SearchDataControls } from "@/components/data-view-controls";
import { DataViewEmpty } from "@/components/data-view-state";
import { CopyIcon, EditIcon, ReceiptIcon, SearchIcon } from "@/components/icons";
import { KeyMetrics } from "@/components/key-metrics";
import { Badge } from "@/components/ui/badge";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import {
  accountTypeLabels,
  financeAccountBalance,
  financeAccountType,
  financeAccountTypeLabel,
} from "./account-type";
import { financeAccountTypeIcon } from "./account-type-icon";
import { financeAccountNeedsAttention, financeAccountNeedsConnectionAttention } from "./attention";
import { BankAccount } from "./bank-account";
import { FinanceSection } from "./finance-section";
import { accountOwnership, FinanceAccountRecord, financeObservedAt } from "./position-material";

const viewParams = [
  "accountSearch",
  "accountType",
  "institution",
  "accountState",
  "planning",
  "accountSort",
] as const;
function stateLabel(account: FinanceAccount) {
  if (account.status === "needs_reauth") return "Reconnect required";
  if (account.provider === "manual" || account.status === "manual") return "Manually tracked";
  return { current: "Current", stale: "Stale", retrying: "Retrying", blocked: "Blocked" }[
    account.synchronization.state
  ];
}

/** Search and filters are navigation state; table layout is persisted separately per owner. */
export function FinanceAccountsView({
  accounts,
  ownerId,
  duplicateGroups,
  onEdit,
  onCompareDuplicates,
  attentionAction,
}: {
  accounts: FinanceAccount[];
  ownerId?: string;
  duplicateGroups: Array<{ accountIds: string[] }>;
  onEdit: (account: FinanceAccount) => void;
  onCompareDuplicates?: (account: FinanceAccount) => void;
  attentionAction: (account: FinanceAccount, iconOnly?: boolean) => ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const ephemeralOwner = useId();
  const value = (key: (typeof viewParams)[number]) => params.get(key) ?? "";
  const change = (key: (typeof viewParams)[number], next: string) =>
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        if (next) updated.set(key, next);
        else updated.delete(key);
        return updated;
      },
      { replace: true },
    );
  const reset = () =>
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        for (const key of viewParams) updated.delete(key);
        return updated;
      },
      { replace: true },
    );
  const duplicateNames = (account: FinanceAccount) => {
    const ids = new Set(
      duplicateGroups
        .filter((group) => group.accountIds.includes(account.id))
        .flatMap((group) => group.accountIds),
    );
    return accounts
      .filter((other) => other.id !== account.id && ids.has(other.id))
      .map((other) => other.name);
  };
  const attention = (account: FinanceAccount) =>
    financeAccountNeedsAttention(account, duplicateNames(account).length > 0);
  const search = value("accountSearch").trim().toLocaleLowerCase();
  const matches = accounts.filter((account) => {
    const haystack = [
      account.name,
      account.institution,
      account.accountMask,
      financeAccountTypeLabel(account),
      account.providerSubtype,
      account.provider,
      stateLabel(account),
      accountOwnership(account),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return (
      (!search || haystack.includes(search)) &&
      (!value("accountType") || financeAccountType(account) === value("accountType")) &&
      (!value("institution") || account.institution === value("institution")) &&
      (!value("accountState") ||
        (value("accountState") === "attention"
          ? attention(account)
          : value("accountState") === "manual"
            ? account.provider === "manual"
            : account.provider !== "manual" &&
              account.status !== "manual" &&
              account.synchronization.state === "current" &&
              !financeAccountNeedsConnectionAttention(account))) &&
      (!value("planning") || account.includeInPlanning === (value("planning") === "included"))
    );
  });
  const sort = value("accountSort");
  matches.sort((a, b) => {
    if (sort === "institution")
      return a.institution.localeCompare(b.institution) || a.name.localeCompare(b.name);
    if (sort === "type")
      return (
        financeAccountTypeLabel(a).localeCompare(financeAccountTypeLabel(b)) ||
        a.name.localeCompare(b.name)
      );
    if (sort === "balance") {
      if (a.balance === null || b.balance === null)
        return a.balance === b.balance ? a.name.localeCompare(b.name) : a.balance === null ? 1 : -1;
      return (
        (a.currencyCode ?? "").localeCompare(b.currencyCode ?? "") ||
        b.balance - a.balance ||
        a.name.localeCompare(b.name)
      );
    }
    return a.name.localeCompare(b.name);
  });
  const cards = matches.filter((account) =>
    ["credit_card", "debit_card"].includes(financeAccountType(account)),
  );
  const institutions = [...new Set(accounts.map((account) => account.institution))].sort();
  const filters = [
    {
      id: "accountType",
      label: "Account type",
      choices: [["", "All types"], ...Object.entries(accountTypeLabels)],
    },
    {
      id: "institution",
      label: "Institution",
      choices: [["", "All institutions"], ...institutions.map((name) => [name, name] as const)],
    },
    {
      id: "accountState",
      label: "Connection",
      choices: [
        ["", "All connections"],
        ["attention", "Needs attention"],
        ["connected", "Connected and current"],
        ["manual", "Manually tracked"],
      ],
    },
    {
      id: "planning",
      label: "Planning",
      choices: [
        ["", "All accounts"],
        ["included", "Included in planning"],
        ["excluded", "Excluded from planning"],
      ],
    },
  ] as const;
  const columns: DataColumn<FinanceAccount>[] = [
    {
      id: "account",
      label: "Account",
      primary: true,
      width: 300,
      value: (account) => account.name,
      cell: (account) => (
        <span
          className="min-w-0"
          id={
            ["credit_card", "debit_card"].includes(financeAccountType(account))
              ? undefined
              : `account-${account.id}`
          }
        >
          <BankAccount account={account} showType={false} />
        </span>
      ),
    },
    {
      id: "balance",
      label: "Balance",
      align: "right",
      mobileOrder: 0,
      mobileFullWidth: true,
      value: financeAccountBalance,
      mobileCell: (account) => (
        <span
          className={
            account.kind === "debt"
              ? "block whitespace-normal break-all text-xs tabular-nums text-destructive"
              : "block whitespace-normal break-all text-xs tabular-nums"
          }
        >
          <span className="sr-only">
            {account.kind === "debt" ? "Amount owed: " : "Current balance: "}
          </span>
          {financeAccountBalance(account)}
        </span>
      ),
      cell: (account) => (
        <div className="flex flex-col gap-1">
          <span
            className={account.kind === "debt" ? "tabular-nums text-destructive" : "tabular-nums"}
            title={account.currencyCode ?? "Currency not provided"}
          >
            {financeAccountBalance(account)}
          </span>
          <span
            className={
              account.kind === "debt" ? "text-xs text-destructive" : "text-xs text-muted-foreground"
            }
          >
            {account.kind === "debt" ? "Amount owed" : "Current balance"}
          </span>
        </div>
      ),
    },
    {
      id: "type",
      label: "Type",
      width: 180,
      mobileOrder: 1,
      mobileLabelHidden: true,
      value: financeAccountTypeLabel,
      cell: (account) => {
        const TypeIcon = financeAccountTypeIcon(financeAccountType(account));
        return (
          <Badge variant="secondary" className="max-w-full whitespace-normal">
            <TypeIcon aria-hidden="true" />
            {financeAccountTypeLabel(account)}
          </Badge>
        );
      },
    },
    {
      id: "status",
      label: "Status",
      mobileLabelHidden: true,
      width: 210,
      value: stateLabel,
      cell: (account) => (
        <div className="flex flex-col gap-1">
          <Badge
            variant={attention(account) ? "destructive" : "secondary"}
            className="max-w-full whitespace-normal"
          >
            {attention(account) ? "Needs attention" : stateLabel(account)}
          </Badge>
          {attention(account) ? (
            <span className="text-xs text-muted-foreground">{stateLabel(account)}</span>
          ) : null}
          {account.synchronization.message ? (
            <span className="text-xs text-muted-foreground">{account.synchronization.message}</span>
          ) : null}
          {duplicateNames(account).length ? (
            <span className="text-xs text-muted-foreground">
              Possible duplicate of {duplicateNames(account).join(", ")}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "institution",
      label: "Institution",
      defaultHidden: true,
      value: (account) => account.institution,
    },
    { id: "ownership", label: "Ownership", defaultHidden: true, value: accountOwnership },
    {
      id: "planning",
      label: "Planning",
      defaultHidden: true,
      value: (account) => (account.includeInPlanning ? "Included" : "Excluded"),
    },
    {
      id: "synced",
      label: "Last synced",
      defaultHidden: true,
      value: (account) =>
        account.lastSyncedAt ? financeObservedAt(account.lastSyncedAt) : "No recorded sync",
    },
    {
      id: "actions",
      kind: "actions",
      label: "Actions",
      width: Math.max(
        80,
        ...matches.map(
          (account) =>
            16 +
            (2 +
              Number(financeAccountNeedsConnectionAttention(account)) +
              Number(
                !!onCompareDuplicates &&
                  account.provider === "plaid" &&
                  duplicateNames(account).length > 0,
              )) *
              30,
        ),
      ),
      value: () => "",
      cell: (account) => (
        <DataTableActions label={`Actions for ${account.name}`}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${account.name}`}
            onClick={() => onEdit(account)}
          >
            <EditIcon aria-hidden="true" />
          </Button>
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            aria-label={`Transactions for ${account.name}`}
          >
            <Link to={`/finances/transactions?accountId=${encodeURIComponent(account.id)}`}>
              <ReceiptIcon aria-hidden="true" />
            </Link>
          </Button>
          {attentionAction(account, true)}
          {onCompareDuplicates &&
          account.provider === "plaid" &&
          duplicateNames(account).length > 0 ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Compare duplicates for ${account.name}`}
              onClick={() => onCompareDuplicates(account)}
            >
              <CopyIcon aria-hidden="true" />
            </Button>
          ) : null}
        </DataTableActions>
      ),
    },
  ];
  return (
    <>
      <WorkspaceHeaderControls label="Account search and filters" placement="workspace">
        <InputGroup className="w-full min-w-0">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search accounts"
            placeholder="Search accounts…"
            value={value("accountSearch")}
            onChange={(event) => change("accountSearch", event.target.value)}
          />
          <SearchDataControls>
            <FilterBar
              collapsed
              filters={filters.map((filter) => ({
                id: filter.id,
                label: filter.label,
                active: !!value(filter.id),
                control: (
                  <DataChoice
                    label={filter.label}
                    value={value(filter.id)}
                    choices={filter.choices}
                    onChange={(next) => change(filter.id, next)}
                    active={!!value(filter.id)}
                  />
                ),
              }))}
            />
            <DataChoice
              label="Sort accounts"
              ariaLabel="Sort accounts"
              sorting
              value={sort}
              choices={[
                ["", "Name"],
                ["institution", "Institution"],
                ["type", "Account type"],
                ["balance", "Balance (by currency)"],
              ]}
              onChange={(next) => change("accountSort", next)}
            />
          </SearchDataControls>
        </InputGroup>
      </WorkspaceHeaderControls>
      {cards.length ? (
        <FinanceSection title="Cards" label="Card accounts">
          <div className="credit-account-rail min-w-0">
            <KeyMetrics label="Cards">
              {cards.map((account) => (
                <FinanceAccountRecord
                  key={account.id}
                  card
                  account={account}
                  duplicateNames={duplicateNames(account)}
                  onEdit={() => onEdit(account)}
                  attentionAction={attentionAction(account)}
                />
              ))}
            </KeyMetrics>
          </div>
        </FinanceSection>
      ) : null}
      {!matches.length ? (
        <DataViewEmpty
          title="No matching accounts"
          description="Try another search or clear the filters to see your accounts."
        >
          <Button variant="secondary" onClick={reset}>
            Clear search and filters
          </Button>
        </DataViewEmpty>
      ) : (
        <DataTable
          rows={matches}
          columns={columns}
          rowId={(account) => account.id}
          rowLabel={(account) => `Open account ${account.name}`}
          onOpen={onEdit}
          storageKey={`finance-accounts:${ownerId ?? ephemeralOwner}`}
          label="Accounts"
          fileName="accounts.csv"
          caption={`${matches.length} of ${accounts.length} accounts`}
        />
      )}
    </>
  );
}
