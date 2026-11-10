import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useFinanceRead } from "./data";
import { InstitutionLogo } from "./institution-logo";
import { formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Segments } from "./ui";

export function FinanceAccountsScreen() {
  const [tab, setTab] = useState<"Cash" | "Investments" | "Debt" | "Other">("Cash");
  const { accountSearch = "" } = useLocalSearchParams<{ accountSearch?: string }>();
  const search = accountSearch.trim();
  const query = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
  const accounts =
    query.data?.accounts.filter((account) =>
      `${account.name} ${account.institution}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const kind = { Cash: "cash", Investments: "investment", Debt: "debt", Other: "other" }[tab];
  const visible = accounts.filter((account) => account.kind === kind);
  const options: ("Cash" | "Investments" | "Debt" | "Other")[] = ["Cash", "Investments", "Debt"];
  if (query.data?.accounts.some((account) => account.kind === "other") || tab === "Other")
    options.push("Other");
  return (
    <FinanceScreen title="Accounts">
      <Segments value={tab} options={options} onChange={setTab} />
      <ReadState query={query}>
        {!visible.length && (
          <Card>
            <Copy secondary>
              {search
                ? "No matching accounts in this tab."
                : !query.data?.accounts.length
                  ? "No accounts yet. Connected and manual accounts will appear here."
                  : "No accounts in this category yet."}
            </Copy>
          </Card>
        )}
        {!!visible.length && (
          <Card rows>
            {visible.map((account) => (
              <FinanceRow
                key={account.id}
                title={account.name}
                subtitle={[
                  account.institution,
                  account.accountMask ? `••${account.accountMask}` : null,
                  account.status === "needs_reauth"
                    ? "Reconnect needed"
                    : account.status === "manual"
                      ? "Manual"
                      : account.lastSyncedAt
                        ? `Updated ${new Date(account.lastSyncedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                        : "Not synced",
                  !account.includeInPlanning ? "Excluded from planning" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                value={formatMoney(account.balance, account.currencyCode)}
                leading={<InstitutionLogo account={account} />}
                onPress={() =>
                  router.push({ pathname: "/finance-account", params: { id: account.id } })
                }
              />
            ))}
          </Card>
        )}
      </ReadState>
    </FinanceScreen>
  );
}
