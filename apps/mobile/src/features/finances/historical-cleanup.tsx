import { router } from "expo-router";
import { useFinanceRead } from "./data";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState } from "./ui";
export function FinanceHistoricalCleanupScreen() {
  const query = useFinanceRead(["attention"], (api) => api.getFinanceAttention());
  return (
    <FinanceScreen title="Historical cleanup" showTitle={false}>
      <ReadState query={query}>
        {query.data ? (
          <>
            <Card rows>
              <FinanceRow
                title="Preserved review records"
                icon="history"
                value={query.data.historicalRecordCount.toLocaleString()}
              />
              <FinanceRow
                title="Starting month"
                icon="calendar"
                value={query.data.policy?.firstMonth ?? "Not selected"}
              />
            </Card>
            <Copy>
              These records are separate from your active decisions. Older items that affect your
              current budget stay active. Nothing has been deleted or marked resolved.
            </Copy>
            <FinanceRow
              title="Work through history with nohmi"
              icon="mail"
              subtitle="Review verified groups in Finance Chat when you’re ready."
              onPress={() =>
                router.push({ pathname: "/finances/assistant", params: { view: "Conversation" } })
              }
            />
            <FinanceRow
              title="Browse transactions"
              icon="receipt"
              onPress={() =>
                router.push({ pathname: "/finances/spending", params: { view: "Transactions" } })
              }
            />
          </>
        ) : null}
      </ReadState>
    </FinanceScreen>
  );
}
