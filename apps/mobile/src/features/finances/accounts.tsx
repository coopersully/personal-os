import { router } from "expo-router";
import { useState } from "react";
import { TextInput } from "react-native";
import { useTheme } from "../../theme";
import { useFinanceRead } from "./data";
import { formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

export function FinanceAccountsScreen() {
  const [search, setSearch] = useState("");
  const t = useTheme();
  const query = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
  const accounts =
    query.data?.accounts.filter((account) =>
      `${account.name} ${account.institution}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const groups = (["cash", "investment", "debt", "other"] as const).filter((kind) =>
    accounts.some((account) => account.kind === kind),
  );
  return (
    <FinanceScreen title="Accounts">
      <TextInput
        accessibilityLabel="Search accounts"
        placeholder="Search accounts"
        placeholderTextColor={t.secondary}
        value={search}
        onChangeText={setSearch}
        style={{
          color: t.ink,
          backgroundColor: t.surface,
          borderRadius: 12,
          padding: 16,
          minHeight: 48,
        }}
      />
      <ReadState query={query}>
        {!accounts.length && (
          <Card>
            <Copy secondary>
              {search
                ? "No matching accounts."
                : "No accounts yet. Connected and manual accounts will appear here."}
            </Copy>
          </Card>
        )}
        {groups.map((kind) => (
          <Section
            key={kind}
            title={
              { cash: "Cash", investment: "Investments", debt: "Debt", other: "Other accounts" }[
                kind
              ]
            }
          >
            <Card>
              {accounts
                .filter((account) => account.kind === kind)
                .map((account) => (
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
                            ? `Updated ${new Date(account.lastSyncedAt).toLocaleDateString()}`
                            : "Not synced",
                      !account.includeInPlanning ? "Excluded from planning" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    value={formatMoney(account.balance, account.currencyCode)}
                    icon="finances"
                    onPress={() =>
                      router.push({ pathname: "/finance-account", params: { id: account.id } })
                    }
                  />
                ))}
            </Card>
          </Section>
        ))}
      </ReadState>
    </FinanceScreen>
  );
}
