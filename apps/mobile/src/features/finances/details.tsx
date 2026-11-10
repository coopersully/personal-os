import { router, Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { RowActions } from "../../components/row-actions";
import { AccountPreferences } from "./account-preferences";
import { categoryIcon } from "./category-presentation";
import { useFinanceRead } from "./data";
import { InstitutionLogo } from "./institution-logo";
import { financeLabel, formatLocalDate, formatMoney, recordAmount } from "./presentation";
import { Transactions } from "./spending";
import { TransactionCategory } from "./transaction-category";
import { TransactionNotes } from "./transaction-notes";
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
            >
              <InstitutionLogo account={account} />
            </Metric>
            <Card rows>
              <FinanceRow
                centered
                title="Source"
                value={financeLabel(account.provider)}
                icon="finances"
              />
              <FinanceRow
                centered
                title="Status"
                value={financeLabel(account.status)}
                valueTone={account.status === "needs_reauth" ? "attention" : undefined}
                accessibilityHint={
                  account.status === "needs_reauth"
                    ? "Reconnect this account to refresh its data."
                    : undefined
                }
                icon="attention"
              />
              <FinanceRow
                centered
                title="Updated"
                valueTone={
                  account.status !== "manual" &&
                  (!account.lastSyncedAt ||
                    (account.synchronization && account.synchronization.state !== "current"))
                    ? "attention"
                    : undefined
                }
                value={
                  account.lastSyncedAt
                    ? new Date(account.lastSyncedAt).toLocaleString()
                    : "Not synced"
                }
                icon="clock"
              />
              <AccountPreferences key={account.id} account={account} />
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
  const reviews = useFinanceRead(["reviews"], (api) => api.getFinanceReviewQueue());
  const item = query.data?.data;
  const categories = useFinanceRead(
    ["categories"],
    (api) => api.getFinanceCategories(),
    !!item?.allocations?.length,
  );
  const review = reviews.data?.find(
    (entry) => entry.transaction.id === id && entry.status !== "resolved",
  );
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
              label={financeLabel(item.direction)}
              value={recordAmount(item.amount, item.currencyCode)}
              hint={item.pending ? "Pending" : "Posted"}
            />
            <ReadState query={reviews}>{null}</ReadState>
            <Card rows>
              <FinanceRow
                centered
                title="Date"
                value={formatLocalDate(item.date)}
                icon="calendar"
              />
              <ReadState query={accounts}>
                <FinanceRow
                  centered
                  title="Account"
                  value={
                    accounts.data?.accounts.find((account) => account.id === item.accountId)
                      ?.name ?? "Unavailable"
                  }
                  icon="finances"
                />
              </ReadState>
              <TransactionCategory key={item.id} item={item} review={review} />
              {item.categoryRationale && (
                <View style={{ paddingVertical: 12 }}>
                  <Copy secondary>{item.categoryRationale}</Copy>
                </View>
              )}
            </Card>
            <Card rows>
              <FinanceRow
                title="Message nohmi"
                subtitle="Discuss this transaction"
                icon="mail"
                onPress={() =>
                  router.navigate({
                    pathname: "/finances/assistant",
                    params: { view: "Conversation", transactionId: id },
                  })
                }
              />
              <TransactionNotes key={item.id} item={item} />
            </Card>
            {!!item.allocations?.length && (
              <Section title="Splits">
                <Card rows>
                  {item.allocations.map((allocation) => (
                    <FinanceRow
                      key={allocation.id}
                      title={financeLabel(allocation.treatment)}
                      icon={categoryIcon(
                        categories.data?.find((category) => category.id === allocation.categoryId)
                          ?.name ?? "Category",
                      )}
                      subtitle={financeLabel(allocation.state)}
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
