import type { User } from "@personal-os/domain";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BrandPattern } from "@/components/brand-pattern";
import { ChevronRightIcon } from "@/components/icons";
import {
  SettingsRecord,
  SettingsRecordAction,
  SettingsRecordContent,
} from "@/components/settings-record";
import { SidebarItemMeta } from "@/components/sidebar-item-meta";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Item, ItemGroup } from "@/components/ui/item";
import { workspaceIdentities, workspaceIds } from "@/components/workspace-identity";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { ConnectionHealthBadge, connectionHealth } from "../connections/health.js";
import { workspaceSetupNeedsPersonAction } from "./agent-access.js";
import { SettingsSection } from "./settings-layout.js";

export function AccountIdentity({ user }: { user: User }) {
  return (
    <section className="account-profile-identity" aria-label="Your nohmi profile">
      <BrandPattern profile />
      <Avatar className="size-20 text-2xl">
        <AvatarFallback>
          {user.displayName
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0])
            .join("")}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <h2 className="text-3xl font-semibold tracking-tight break-words">{user.displayName}</h2>
        <p className="break-words text-muted-foreground">{user.email}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          Member since{" "}
          {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
            new Date(user.createdAt),
          )}
        </p>
      </div>
    </section>
  );
}

export function AccountOverview() {
  const setup = useQueries({
    queries: workspaceIds.map((domain) => ({
      queryKey: ["ilo-setup-plan", domain],
      queryFn: () => api.getIloSetup({ domain }),
      staleTime: 30_000,
    })),
  });
  const connectors = useQuery({ queryKey: ["connectors"], queryFn: api.listConnectors });
  const bookmarks = useQuery({
    queryKey: ["x-bookmarks", "account"],
    queryFn: api.getXBookmarkAccount,
  });
  const work = useQuery({
    queryKey: ["agent-access-work-items", "all", "all", null],
    queryFn: () => api.listAgentAccessWorkItems({ limit: 10 }),
  });
  return (
    <div className="settings-stack">
      <SettingsSection
        title="Your workspaces"
        description="Review workspace attention and manage your preferences."
      >
        <QueryFeedback query={work} title="Couldn’t check workspace attention." />
        <ItemGroup className="account-workspace-grid">
          {workspaceIds.map((id, index) => {
            const identity = workspaceIdentities[id];
            const unavailable =
              work.isError || setup[index]?.isError || work.data?.unavailableDomains.includes(id);
            const needsSetup = workspaceSetupNeedsPersonAction(setup[index]?.data);
            const count = work.data?.summary.byDomain[id];
            return (
              <Item
                key={id}
                role="listitem"
                className="settings-record account-workspace"
                data-workspace={id}
              >
                <SettingsRecordContent
                  title={
                    <span className="flex items-center gap-2">
                      <identity.icon aria-hidden="true" className="account-workspace__icon" />
                      {identity.label}
                      <SidebarItemMeta
                        inline
                        attention={needsSetup || (!unavailable && Boolean(count))}
                        label={identity.label}
                      />
                    </span>
                  }
                  description={
                    unavailable
                      ? "Attention status unavailable"
                      : needsSetup
                        ? `Setup needs your attention${count ? ` · ${count.toLocaleString()} pending items` : ""}`
                        : count === undefined || setup[index]?.isPending
                          ? "Checking workspace…"
                          : count
                            ? `${count.toLocaleString()} item${count === 1 ? " needs" : "s need"} your attention`
                            : "No pending reviews or attention items"
                  }
                  metadata={
                    <>
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          to={`/settings?section=${id}`}
                          aria-label={`Workspace settings for ${identity.label}`}
                        >
                          Workspace settings
                        </Link>
                      </Button>
                    </>
                  }
                />
              </Item>
            );
          })}
        </ItemGroup>
      </SettingsSection>
      <SettingsSection
        title="Connected accounts"
        action={
          <Button asChild size="sm" variant="ghost">
            <Link to="/settings?section=connections">Manage connections</Link>
          </Button>
        }
      >
        <QueryFeedback query={connectors} title="Couldn’t check connected accounts." />
        <QueryFeedback query={bookmarks} title="Couldn’t check X bookmarks." />
        {connectors.isPending || bookmarks.isPending ? (
          <p className="text-sm text-muted-foreground">Checking connections…</p>
        ) : null}
        <ItemGroup>
          {connectors.data?.map((account) => {
            const health = connectionHealth(account);
            return (
              <SettingsRecord
                key={account.id}
                title={account.label}
                description={account.email ?? "Connected account"}
                metadata={<ConnectionHealthBadge health={health} />}
                actions={
                  <SettingsRecordAction asChild label={`Manage ${account.label}`}>
                    <Link to="/settings?section=connections">
                      <ChevronRightIcon />
                    </Link>
                  </SettingsRecordAction>
                }
              />
            );
          })}
          {bookmarks.data ? (
            <SettingsRecord
              title="X bookmarks"
              description={
                bookmarks.data.syncError
                  ? "Sync error — check your bookmark connection"
                  : "Connected"
              }
              actions={
                <SettingsRecordAction asChild label="Manage X bookmarks">
                  <Link to="/settings?section=connections">
                    <ChevronRightIcon />
                  </Link>
                </SettingsRecordAction>
              }
            />
          ) : null}
        </ItemGroup>
        {connectors.isSuccess &&
        bookmarks.isSuccess &&
        !connectors.data.length &&
        !bookmarks.data ? (
          <p className="text-sm text-muted-foreground">No accounts connected yet.</p>
        ) : null}
      </SettingsSection>
    </div>
  );
}
