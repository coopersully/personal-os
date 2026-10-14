import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { connectionHealth } from "@/features/connections/health";
import { attentionConnections } from "./attention-model";

const interval = () => (document.visibilityState === "visible" ? 60000 : false);
export function TodayAttention() {
  const accounts = useQuery({
    queryKey: ["connectors"],
    queryFn: () => api.listConnectors(),
    refetchInterval: interval,
  });
  const bookmarks = useQuery({
    queryKey: ["x-bookmarks", "account"],
    queryFn: () => api.getXBookmarkAccount(),
    refetchInterval: interval,
  });
  const finance = useQuery({
    queryKey: ["today-attention", "finance"],
    queryFn: () => api.getFinanceStatus(),
    refetchInterval: interval,
  });
  const connections = attentionConnections(accounts.data ?? []);
  const providerItems = finance.data?.details.accounts?.providerItems ?? [];
  const coveredAccounts = new Set(providerItems.flatMap((item) => item.accountIds));
  const blocked = [
    ...providerItems.filter((item) => item.synchronization.state === "blocked"),
    ...(finance.data?.details.accounts?.items ?? []).filter(
      (item) => !coveredAccounts.has(item.id) && item.synchronization.state === "blocked",
    ),
  ].map((item) => ({
    ...item,
    label:
      "name" in item
        ? item.name
        : [
            ...new Set(
              (finance.data?.details.accounts?.items ?? [])
                .filter((account) => item.accountIds.includes(account.id))
                .map((account) => account.institution),
            ),
          ].join(", ") || "Finance connection",
  }));
  const bookmarkFailure = bookmarks.data?.syncStatus === "error";
  const hasAttention = connections.length + blocked.length > 0 || bookmarkFailure;
  return (
    <>
      <QueryFeedback query={accounts} title="Couldn’t check connections." />
      <QueryFeedback query={bookmarks} title="Couldn’t check bookmarks." />
      <QueryFeedback query={finance} title="Couldn’t check finance connections." />
      {hasAttention ? (
        <Card className="today-attention" aria-label="Needs your attention">
          <CardHeader>
            <CardTitle>
              <h2>Needs your attention</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {bookmarkFailure ? (
              <Button variant="secondary" asChild>
                <Link to="/settings?section=connections">X bookmarks · Review connection</Link>
              </Button>
            ) : null}
            {connections.map((account) => (
              <div key={account.id} className="flex items-center justify-between gap-4 py-2">
                <span>
                  {account.label} ·{" "}
                  {connectionHealth(account).state === "reconnect"
                    ? "Reconnect required"
                    : "Service issue"}
                </span>
                <Button variant="outline" asChild>
                  <Link to="/settings?section=connections">Review connection</Link>
                </Button>
              </div>
            ))}
            {blocked.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 py-2">
                <span>
                  {item.label} ·{" "}
                  {item.synchronization.recovery === "reconnect"
                    ? "Reconnect required"
                    : "Service issue"}
                </span>
                <Button variant="outline" asChild>
                  <Link to="/finances/accounts">Review account</Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
