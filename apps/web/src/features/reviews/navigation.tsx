import type { AgentAccessDomain } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ActionButton as Button } from "@/components/action-button";
import { ApprovalHandIcon } from "@/components/icons";
import { formatSidebarCount } from "@/components/sidebar-item-meta";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { workspaceIdentities } from "@/components/workspace-identity";
import { api } from "../../api.js";

export function ReviewNavigation({
  workspace,
  footer = false,
}: {
  workspace: AgentAccessDomain;
  footer?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ["agent-access-work-items", "navigation", workspace],
    queryFn: () => api.listAgentAccessWorkItems({ domain: workspace, limit: 10 }),
    refetchInterval: 60_000,
  });
  const count = query.data?.summary.byDomain[workspace];
  const unavailable = query.isError || query.data?.unavailableDomains.includes(workspace);
  if (!unavailable && count === 0) return null;
  const needsAttention = unavailable || (typeof count === "number" && count > 0);
  const label = unavailable
    ? "Check review status"
    : typeof count === "number"
      ? `${count.toLocaleString()} ${count === 1 ? "item needs" : "items need"} review`
      : "Checking reviews…";
  const active = params.has("review");
  const open = () =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("review", "open");
      return next;
    });
  const content = (
    <>
      <ApprovalHandIcon aria-hidden weight={active ? "Filled" : "Outline"} />
      <span className="review-navigation__label">{label}</span>
      <span aria-hidden="true" className="review-navigation__count">
        {unavailable ? "!" : typeof count === "number" ? formatSidebarCount(count) : "…"}
      </span>
    </>
  );
  return footer ? (
    <SidebarFooter className="review-navigation__footer">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            aria-label={label}
            className="review-navigation"
            tooltip={label}
            data-attention={needsAttention || undefined}
            onClick={open}
            isActive={active}
          >
            {content}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  ) : (
    <Button
      tooltip={label}
      aria-label={label}
      className="review-navigation"
      data-attention={needsAttention || undefined}
      onClick={open}
      variant="ghost"
      size="sm"
    >
      {content}
    </Button>
  );
}

/** Today exposes the same review action, with a workspace chooser for its aggregate scope. */
export function TodayReviewNavigation() {
  const query = useQuery({
    queryKey: ["agent-access-work-items", "today"],
    queryFn: () => api.listAgentAccessWorkItems({ limit: 10 }),
    refetchInterval: 60_000,
  });
  const domains = ["calendar", "tasks", "mail", "finances"] as const;
  const unavailable = query.isError || !!query.data?.unavailableDomains.length;
  const count = query.data?.summary.total;
  if (count === 0 && !unavailable) return null;
  const label = unavailable
    ? "Check review status"
    : typeof count === "number"
      ? `${count.toLocaleString()} ${count === 1 ? "item needs" : "items need"} review`
      : "Checking reviews…";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={label}
          tooltip={label}
          className="review-navigation"
          variant="ghost"
          size="sm"
          data-attention={unavailable || !!count || undefined}
        >
          <ApprovalHandIcon aria-hidden="true" />
          <span className="review-navigation__label">{label}</span>
          <span className="review-navigation__count" aria-hidden="true">
            {unavailable ? "!" : (count ?? "…")}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label="Workspace reviews">
        {domains.map((domain) => {
          const total = query.data?.summary.byDomain[domain];
          const unknown =
            query.isError || query.data?.unavailableDomains.includes(domain) || total == null;
          return total === 0 && !unknown ? null : (
            <DropdownMenuItem key={domain} asChild>
              <Link to={`/${domain}?review=open`}>
                {workspaceIdentities[domain].label}
                <span className="ml-auto">{unknown ? "!" : total}</span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
