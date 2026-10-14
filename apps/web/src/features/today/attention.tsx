import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  const unknown = bookmarks.isError || accounts.isError || finance.isError;
  const bookmarkFailure = bookmarks.data?.syncStatus === "error";
  const hasAttention = connections.length + blocked.length > 0 || bookmarkFailure;
  if (!hasAttention && !unknown) return null;
  return (
    <Card className="today-attention py-0" aria-label="Needs your attention">
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">
            {hasAttention ? "Needs your attention" : "Some connections could not be checked"}
          </h2>
          {unknown ? (
            <Button
              variant="outline"
              onClick={() => {
                toast.promise(
                  Promise.all([accounts.refetch(), finance.refetch(), bookmarks.refetch()]).then(
                    (results) => {
                      if (results.some((result) => result.isError))
                        throw new Error("Source unavailable");
                    },
                  ),
                  {
                    loading: "Checking attention sources…",
                    success: "Attention sources refreshed.",
                    error: "Some attention sources could not be refreshed.",
                  },
                );
              }}
            >
              Refresh
            </Button>
          ) : null}
        </div>
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
        {hasAttention && unknown ? (
          <p className="text-sm text-muted-foreground">Additional sources could not be checked.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
