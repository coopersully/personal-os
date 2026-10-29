import type { User } from "@personal-os/domain";
import { useQueries, useQuery } from "@tanstack/react-query";
import { BrandMark } from "@/components/brand-marks";
import { BrandPattern } from "@/components/brand-pattern";
import { DataViewRecovery } from "@/components/data-view-state";
import { CloudIcon } from "@/components/icons";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { workspaceIdentities, workspaceIds } from "@/components/workspace-identity";
import { settingsPath } from "@/features/settings/settings-routes";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { ConnectionHealthBadge, connectionHealth } from "../connections/health.js";
import { workspaceSetupNeedsPersonAction } from "./agent-access.js";
import { ProfileRow, ProfileSection } from "./profile-rows.js";

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
      queryKey: ["personal-os-setup-plan", domain],
      queryFn: () => api.getPersonalOsSetup({ domain }),
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
      <ProfileSection title="Workspaces">
        <QueryFeedback query={work} title="Couldn’t check workspace attention." />
        {workspaceIds.map((id, index) => {
          const identity = workspaceIdentities[id];
          const unavailable =
            work.isError || setup[index]?.isError || work.data?.unavailableDomains.includes(id);
          const needsSetup = workspaceSetupNeedsPersonAction(setup[index]?.data);
          const count = work.data?.summary.byDomain[id];
          return (
            <ProfileRow
              key={id}
              icon={
                <span
                  className="workspace-icon profile-workspace-icon"
                  data-size="md"
                  data-workspace={id}
                >
                  <identity.icon weight="Filled" />
                </span>
              }
              label={identity.label}
              to={settingsPath(id)}
              value={
                unavailable
                  ? "Unavailable"
                  : needsSetup
                    ? "Setup needed"
                    : count === undefined || setup[index]?.isPending
                      ? "Checking…"
                      : count
                        ? `${count} pending`
                        : "Up to date"
              }
            />
          );
        })}
      </ProfileSection>
      <ProfileSection title="Connections">
        <DataViewRecovery
          query={connectors}
          title="Couldn’t check connected accounts."
          unavailableLabel="Connections unavailable"
        />
        <DataViewRecovery
          query={bookmarks}
          title="Couldn’t check X bookmarks."
          unavailableLabel="X bookmarks unavailable"
        />
        {connectors.data?.map((account) => (
          <ProfileRow
            key={account.id}
            icon={<BrandMark brand={account.provider} className="size-5" />}
            label={account.label}
            value={
              <span className="flex items-center gap-2">
                <span className="truncate">{account.email ?? "Connected"}</span>
                <ConnectionHealthBadge health={connectionHealth(account)} />
              </span>
            }
            to="/settings?page=connections"
          />
        ))}
        {bookmarks.data ? (
          <ProfileRow
            icon={<BrandMark brand="x" className="size-5" />}
            label="X bookmarks"
            value={bookmarks.data.syncError ? "Needs attention" : "Connected"}
            to="/settings?page=connections"
          />
        ) : null}
        <ProfileRow
          icon={
            <span className="profile-destination-icon">
              <CloudIcon weight="Filled" />
            </span>
          }
          label="Manage connections"
          value={connectors.isPending || bookmarks.isPending ? "Checking…" : undefined}
          to="/settings?page=connections"
        />
      </ProfileSection>
    </div>
  );
}
