import type { AuditEvent } from "@personal-os/api-client";
import { EmptyState } from "@personal-os/ui";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronDown, Cloud, Command, Search, UserRound } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { api } from "../../api.js";
import { InlineError, PageLoading } from "../../components/async-state.js";
import { formatRelativeTime } from "../../lib/time-format.js";

export function ActivityTopbarControls() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = activitySearchFromSearch(searchParams);
  const [searchDraft, setSearchDraft] = useState(search);

  useEffect(() => setSearchDraft(search), [search]);

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        const query = searchDraft.trim();
        if (query) next.set("q", query);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  };

  return (
    <form onSubmit={applySearch}>
      <InputGroup className="activity-topbar__search">
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search activity"
          onChange={(event) => {
            const value = event.currentTarget.value;
            setSearchDraft(value);
            if (!value) {
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  next.delete("q");
                  return next;
                },
                { replace: true },
              );
            }
          }}
          placeholder="Search activity"
          type="search"
          value={searchDraft}
        />
      </InputGroup>
    </form>
  );
}

export function ActivityPage() {
  const [searchParams] = useSearchParams();
  const search = activitySearchFromSearch(searchParams);
  const activity = useQuery({ queryFn: () => api.listActivity(100), queryKey: ["activity"] });

  if (activity.isPending) return <PageLoading />;
  if (activity.isError) return <InlineError error={activity.error} />;

  const entries = filterActivityEvents(activity.data, search);
  return (
    <div className="narrow-page">
      {activity.data.length === 0 ? (
        <EmptyState icon={<Activity />} title="No activity yet">
          Changes made by you, agents, connectors, and ilo will collect here.
        </EmptyState>
      ) : entries.length === 0 ? (
        <EmptyState icon={<Search />} title="No matching activity">
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

export function activitySearchFromSearch(searchParams: URLSearchParams): string {
  return searchParams.get("q")?.trim() ?? "";
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
  return Map.groupBy(entries, (entry) => `${entry.requestId}:${entry.actorType}:${entry.action}`);
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
        <ChevronDown aria-hidden="true" size={17} />
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
  if (actorType === "agent") return <Command size={17} />;
  if (actorType === "connector") return <Cloud size={17} />;
  return <UserRound size={17} />;
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
