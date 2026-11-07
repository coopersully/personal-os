import { router, Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { RowActions } from "../../components/row-actions";
import { useFinanceRead } from "./data";
import { formatLocalDate, formatMoney, recordAmount } from "./presentation";
import { Transactions } from "./spending";
import { Card, Copy, FinanceRow, FinanceScreen, Metric, ReadState, Section } from "./ui";

export function FinanceAccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
  const account = query.data?.accounts.find((item) => item.id === id);
  return (
    <FinanceScreen title={account?.name ?? "Account"}>
      <ReadState query={query}>
        {account ? (
          <>
            <Metric
              label={account.institution}
              value={formatMoney(account.balance, account.currencyCode)}
              hint={account.accountMask ? `••${account.accountMask}` : undefined}
            />
            <Card rows>
              <FinanceRow centered title="Source" value={account.provider} icon="finances" />
              <FinanceRow
                centered
                title="Status"
                value={account.status.replaceAll("_", " ")}
                icon="attention"
              />
              <FinanceRow
                centered
                title="Updated"
                value={
                  account.lastSyncedAt
                    ? new Date(account.lastSyncedAt).toLocaleString()
                    : "Not synced"
                }
                icon="clock"
              />
              <FinanceRow centered title="Ownership" value={account.ownershipType} icon="people" />
              <FinanceRow
                centered
                title="Planning"
                value={account.includeInPlanning ? "Included" : "Excluded"}
                icon="wallet"
              />
            </Card>
            <Section title="Transactions">
              <Transactions accountId={id} />
            </Section>
          </>
        ) : (
          <Copy secondary>This account is unavailable.</Copy>
        )}
      </ReadState>
    </FinanceScreen>
  );
}
export function FinanceTransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useFinanceRead(["transaction", id], (api) => api.getFinanceTransaction(id), !!id);
  const accounts = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
  const item = query.data?.data;
  return (
    <FinanceScreen title={item?.merchant ?? "Transaction"}>
      <Stack.Screen
        options={{
          headerRight: () =>
            item ? (
              <RowActions
                placement="header"
                label="Transaction actions"
                actions={[
                  {
                    id: "edit",
                    label: "Edit transaction",
                    icon: "edit",
                    onPress: () =>
                      router.push({ pathname: "/finance-transaction-edit", params: { id } }),
                  },
                ]}
              />
            ) : null,
        }}
      />
      <ReadState query={query}>
        {item ? (
          <>
            <Metric
              label={item.direction}
              value={recordAmount(item.amount, item.currencyCode)}
              hint={`${item.pending ? "Pending" : "Posted"}${!item.currencyCode ? " · Currency unknown" : ""}`}
            />
            <Card rows>
              <FinanceRow
                centered
                title="Date"
                value={formatLocalDate(item.date)}
                icon="calendar"
              />
              <FinanceRow
                centered
                title="Account"
                value={
                  accounts.data?.accounts.find((account) => account.id === item.accountId)?.name ??
                  "Unavailable"
                }
                icon="finances"
              />
              <FinanceRow
                centered
                title="Category"
                value={item.category ?? "Uncategorized"}
                icon="grid"
              />
              {item.categoryRationale && (
                <View style={{ paddingVertical: 12 }}>
                  <Copy secondary>{item.categoryRationale}</Copy>
                </View>
              )}
            </Card>
            {item.notes && (
              <Section title="Notes">
                <Card>
                  <Copy>{item.notes}</Copy>
                </Card>
              </Section>
            )}
            {!!item.allocations?.length && (
              <Section title="Splits">
                <Card rows>
                  {item.allocations.map((allocation) => (
                    <FinanceRow
                      key={allocation.id}
                      title={allocation.treatment}
                      subtitle={allocation.state}
                      value={recordAmount(allocation.amount, item.currencyCode)}
                    />
                  ))}
                </Card>
              </Section>
            )}
          </>
        ) : (
          <Copy secondary>This transaction is unavailable.</Copy>
        )}
      </ReadState>
    </FinanceScreen>
  );
}
