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
  const work = useQuery({
    queryKey: ["agent-access-work-items", "today"],
    queryFn: () => api.listAgentAccessWorkItems({ limit: 10 }),
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
  ];
  const domains = (["calendar", "finances", "mail", "tasks"] as const)
    .map((domain) => {
      const reviews = work.data?.summary.reviewByDomain?.[domain];
      const attention = work.data?.summary.attentionByDomain?.[domain];
      return [
        domain,
        reviews === null || attention === null ? null : (reviews ?? 0) + (attention ?? 0),
      ] as const;
    })
    .filter(([, count]) => count !== null && count > 0);
  const unknown =
    bookmarks.isError ||
    accounts.isError ||
    finance.isError ||
    work.isError ||
    !!work.data?.unavailableDomains.length ||
    work.data?.summary.total === null ||
    (!!work.data && (!work.data.summary.reviewByDomain || !work.data.summary.attentionByDomain));
  const checking = accounts.isPending || finance.isPending || work.isPending || bookmarks.isPending;
  const bookmarkFailure = bookmarks.data?.syncStatus === "error";
  const hasAttention = connections.length + blocked.length + domains.length > 0 || bookmarkFailure;
  return (
    <Card className="today-attention py-0" aria-label="Needs your attention">
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">
            {hasAttention
              ? "Needs your attention"
              : checking
                ? "Checking connections and reviews…"
                : unknown
                  ? "Some attention sources are unavailable"
                  : "Connections and reviews are clear"}
          </h2>
          {unknown ? (
            <Button
              variant="outline"
              onClick={() => {
                toast.promise(
                  Promise.all([
                    accounts.refetch(),
                    finance.refetch(),
                    work.refetch(),
                    bookmarks.refetch(),
                  ]).then((results) => {
                    if (results.some((result) => result.isError))
                      throw new Error("Source unavailable");
                  }),
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
              Finance connection ·{" "}
              {item.synchronization.recovery === "reconnect"
                ? "Reconnect required"
                : "Service issue"}
            </span>
            <Button variant="outline" asChild>
              <Link to="/finances/accounts">Review account</Link>
            </Button>
          </div>
        ))}
        {domains.map(([domain, count]) => (
          <Button key={domain} variant="secondary" asChild>
            <Link to={`/${domain}?review=open`} aria-label={`Open ${domain} attention: ${count}`}>
              {domain[0]?.toUpperCase()}
              {domain.slice(1)} · {count}
            </Link>
          </Button>
        ))}
        {hasAttention && unknown ? (
          <p className="text-sm text-muted-foreground">Additional sources could not be checked.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
