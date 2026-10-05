import type { AgentAccessDomain } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ApprovalHandIcon } from "@/components/icons";
import { formatSidebarCount } from "@/components/sidebar-item-meta";
import { Button } from "@/components/ui/button";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
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
