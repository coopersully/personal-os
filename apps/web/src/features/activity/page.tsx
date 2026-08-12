import type { AuditEvent } from "@personal-os/api-client";
import { EmptyState } from "@personal-os/ui";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  ActivityIcon,
  ChevronDownIcon,
  CloudIcon,
  CommandIcon,
  SearchIcon,
  UserIcon,
} from "@/components/icons";
import { api } from "../../api.js";
import { InlineError, PageLoading } from "../../components/async-state.js";
import { WorkspaceSearch, workspaceSearchFromParams } from "../../components/workspace-search.js";
import { formatRelativeTime } from "../../lib/time-format.js";

export function ActivityTopbarControls() {
  return <WorkspaceSearch label="Search activity" />;
}

export function ActivityPage() {
  const [searchParams] = useSearchParams();
  const search = workspaceSearchFromParams(searchParams).trim();
  const activity = useQuery({ queryFn: () => api.listActivity(100), queryKey: ["activity"] });

  if (activity.isPending) return <PageLoading />;
  if (activity.isError) return <InlineError error={activity.error} />;

  const entries = filterActivityEvents(activity.data, search);
  return (
    <div className="narrow-page">
      {activity.data.length === 0 ? (
        <EmptyState icon={<ActivityIcon />} title="No activity yet">
          Changes made by you, agents, connectors, and ilo will collect here.
        </EmptyState>
      ) : entries.length === 0 ? (
        <EmptyState icon={<SearchIcon />} title="No matching activity">
          Try another action, actor, or material.
        </EmptyState>
      ) : (
        <div className="activity-list">
          {[...groupActivityEvents(entries).entries()].map(([key, groupedEntries]) =>
            groupedEntries.length === 1 ? (
              <ActivityRow entry={groupedEntries[0] as AuditEvent} key={key} />
            ) : (
              <ActivityBatch entries={groupedEntries} key={key} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function filterActivityEvents(entries: AuditEvent[], search: string): AuditEvent[] {
  const query = search.toLocaleLowerCase();
  if (!query) return entries;
  return entries.filter((entry) =>
    [
      entry.action,
      humanizeAction(entry.action),
      actorLabel(entry.actorType),
      entry.entityType,
    ].some((value) => value.toLocaleLowerCase().includes(query)),
  );
}

function groupActivityEvents(entries: AuditEvent[]): Map<string, AuditEvent[]> {
  return entries.reduce<Map<string, AuditEvent[]>>((groups, entry) => {
    const key = `${entry.requestId}:${entry.actorType}:${entry.action}`;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
    return groups;
  }, new Map());
}

function ActivityBatch({ entries }: { entries: AuditEvent[] }) {
  const first = entries[0] as AuditEvent;
  const actor = actorLabel(first.actorType);
  return (
    <details className="activity-batch">
      <summary>
        <div className={`activity-row__actor actor--${first.actorType}`}>
          <ActivityActorIcon actorType={first.actorType} />
        </div>
        <div className="activity-batch__summary">
          <strong>{humanizeAction(first.action)}</strong>
          <span>
            {actor} · {entries.length} changes · {formatRelativeTime(first.createdAt)}
          </span>
        </div>
        <ChevronDownIcon aria-hidden="true" className="size-[17px]" />
      </summary>
      <div className="activity-batch__entries">
        {entries.map((entry) => (
          <ActivityRow entry={entry} key={entry.id} />
        ))}
      </div>
    </details>
  );
}

function actorLabel(actorType: string): string {
  if (actorType === "agent") return "Agent";
  if (actorType === "connector") return "Connector";
  if (actorType === "system") return "System";
  return "You";
}

function ActivityActorIcon({ actorType }: { actorType: string }) {
  if (actorType === "agent") return <CommandIcon className="size-[17px]" />;
  if (actorType === "connector") return <CloudIcon className="size-[17px]" />;
  return <UserIcon className="size-[17px]" />;
}

function ActivityRow({ entry }: { entry: AuditEvent }) {
  const actor = actorLabel(entry.actorType);
  return (
    <article className="activity-row">
      <div className={`activity-row__actor actor--${entry.actorType}`}>
        <ActivityActorIcon actorType={entry.actorType} />
      </div>
      <div>
        <strong>{humanizeAction(entry.action)}</strong>
        <span>
          {actor} · {formatRelativeTime(entry.createdAt)}
        </span>
      </div>
    </article>
  );
}

function humanizeAction(action: string) {
  return action
    .split(".")
    .map((part) => part.replaceAll("_", " "))
    .join(" · ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
