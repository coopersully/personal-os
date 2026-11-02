import type { AuditEvent } from "@personal-os/api-client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type DataColumn, DataTable } from "@/components/data-table";
import { DataChoice, FilterBar, SearchDataControls } from "@/components/data-view-controls";
import { DataViewEmpty, DataViewLoading, DataViewRecovery } from "@/components/data-view-state";
import { SearchIcon } from "@/components/icons";
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
  ResponsiveDialogBody,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { api } from "../../api.js";
import { workspaceSearchFromParams } from "../../components/workspace-search.js";
import { formatRelativeTime } from "../../lib/time-format.js";

type ActivityRecord = { first: AuditEvent; entries: AuditEvent[] };
// The dataset owns one joined search toolbar, including on the legacy route.
export function ActivityTopbarControls() {
  return null;
}
export function ActivityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = workspaceSearchFromParams(searchParams);
  const [actor, setActor] = useState("all");
  const [object, setObject] = useState("all");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(0);
  const [opened, setOpened] = useState<ActivityRecord | null>(null);
  const activity = useQuery({ queryFn: () => api.listActivity(100), queryKey: ["activity"] });
  const change = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(0);
  };
  const entries = filterActivityEvents(activity.data ?? [], search).filter(
    (entry) =>
      (actor === "all" || entry.actorType === actor) &&
      (object === "all" || entry.entityType === object),
  );
  const records = Array.from(groupActivityEvents(entries).values())
    .flatMap((entries) => (entries[0] ? [{ first: entries[0], entries }] : []))
    .sort(
      (a, b) => (sort === "newest" ? -1 : 1) * a.first.createdAt.localeCompare(b.first.createdAt),
    );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(records.length / 10) - 1));
  const visible = records.slice(currentPage * 10, currentPage * 10 + 10);
  const columns: DataColumn<ActivityRecord>[] = [
    {
      id: "action",
      label: "Change",
      primary: true,
      width: 220,
      value: (row) => humanizeAction(row.first.action),
      mobileCell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span>{humanizeAction(row.first.action)}</span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(row.first.createdAt)}
          </span>
        </span>
      ),
    },
    { id: "actor", label: "By", width: 90, value: (row) => actorLabel(row.first.actorType) },
    {
      id: "object",
      label: "Object",
      width: 130,
      value: (row) => humanizeAction(row.first.entityType),
    },
    { id: "count", label: "Changes", width: 80, value: (row) => row.entries.length },
    {
      id: "date",
      label: "When",
      width: 130,
      value: (row) => row.first.createdAt,
      cell: (row) => formatRelativeTime(row.first.createdAt),
      mobileHidden: true,
    },
    { id: "request", label: "Request", defaultHidden: true, value: (row) => row.first.requestId },
  ];
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="Activity history">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search activity"
          placeholder="Search changes…"
          type="search"
          value={search}
          onChange={(event) => {
            const next = new URLSearchParams(searchParams);
            if (event.target.value) next.set("q", event.target.value);
            else next.delete("q");
            setSearchParams(next, { replace: true });
            setPage(0);
          }}
        />
        <SearchDataControls>
          <FilterBar
            collapsed
            filters={[
              {
                id: "actor",
                label: "Changed by",
                active: actor !== "all",
                control: (
                  <DataChoice
                    label="Changed by"
                    value={actor}
                    onChange={change(setActor)}
                    choices={[
                      ["all", "Anyone"],
                      ["user", "You"],
                      ["agent", "Agents"],
                      ["connector", "Connectors"],
                      ["system", "System"],
                    ]}
                  />
                ),
              },
              {
                id: "object",
                label: "Object",
                active: object !== "all",
                control: (
                  <DataChoice
                    label="Object"
                    value={object}
                    onChange={change(setObject)}
                    choices={[
                      ["all", "All Objects"],
                      ...Array.from(new Set((activity.data ?? []).map((e) => e.entityType)))
                        .sort()
                        .map((type) => [type, humanizeAction(type)] as const),
                    ]}
                  />
                ),
              },
            ]}
          >
            {records.length ? (
              <DataChoice
                label="Sort"
                sorting
                value={sort}
                onChange={change(setSort)}
                choices={[
                  ["newest", "Newest First"],
                  ["oldest", "Oldest First"],
                ]}
              />
            ) : null}
          </FilterBar>
        </SearchDataControls>
      </InputGroup>
      <DataViewRecovery
        query={activity}
        title="Couldn’t load activity."
        unavailableLabel="Activity unavailable"
      />
      {activity.isPending ? (
        <DataViewLoading label="Loading activity" />
      ) : activity.data?.length || activity.isSuccess ? (
        records.length ? (
          <>
            <DataTable
              rows={visible}
              columns={columns}
              rowId={(row) => row.first.id}
              rowLabel={(row) =>
                `${humanizeAction(row.first.action)} · ${formatRelativeTime(row.first.createdAt)}`
              }
              onOpen={setOpened}
              storageKey="activity"
              label="Activity entries"
              fileName="activity.csv"
              caption={
                activity.data.length >= 100
                  ? "Latest 100 changes; search and filters apply to these changes."
                  : undefined
              }
            />
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                {currentPage * 10 + 1}–{Math.min((currentPage + 1) * 10, records.length)} of{" "}
                {records.length} records
              </span>
              {records.length > 10 ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={(currentPage + 1) * 10 >= records.length}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <DataViewEmpty
            title={(activity.data?.length ?? 0) > 0 ? "No matching activity" : "No activity yet"}
            description={
              (activity.data?.length ?? 0) > 0
                ? "Try a different search or broaden your filters."
                : "Changes made by you, agents, and connected services will appear here."
            }
          >
            {search || actor !== "all" || object !== "all" ? (
              <Button
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("q");
                  setSearchParams(next);
                  setActor("all");
                  setObject("all");
                  setPage(0);
                }}
              >
                Show all activity
              </Button>
            ) : null}
          </DataViewEmpty>
        )
      ) : null}
      <Dialog
        open={!!opened}
        onOpenChange={(open) => {
          if (!open) setOpened(null);
        }}
      >
        <DialogContent
          className="flex max-h-[85dvh] flex-col overflow-hidden"
          showCloseButton={false}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {opened ? humanizeAction(opened.first.action) : "Activity details"}
            </DialogTitle>
            <DialogDescription>
              {opened
                ? `${actorLabel(opened.first.actorType)} · ${opened.entries.length} changes · ${formatRelativeTime(opened.first.createdAt)}`
                : null}
            </DialogDescription>
          </DialogHeader>
          <ResponsiveDialogBody>
            <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto">
              {opened?.entries.map((entry) => (
                <section key={entry.id} className="flex min-w-0 flex-col gap-2">
                  <p className="text-sm font-medium">{humanizeAction(entry.entityType)}</p>
                  <p className="text-xs text-muted-foreground">{changedFields(entry)}</p>
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Recorded values
                    </summary>
                    <p className="break-all py-2 text-xs text-muted-foreground">{entry.entityId}</p>
                    {[
                      ["Before", entry.before],
                      ["After", entry.after],
                    ]
                      .filter(([, value]) => value !== null && value !== undefined)
                      .map(([label, value]) => (
                        <div key={String(label)}>
                          <p className="text-xs text-muted-foreground">{String(label)}</p>
                          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">
                            {JSON.stringify(value, null, 2)}
                          </pre>
                        </div>
                      ))}
                  </details>
                </section>
              ))}
            </div>
          </ResponsiveDialogBody>
          <DialogFooter className="shrink-0">
            <Button onClick={() => setOpened(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
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

function actorLabel(actorType: string): string {
  if (actorType === "agent") return "Agent";
  if (actorType === "connector") return "Connector";
  if (actorType === "system") return "System";
  return "You";
}

function humanizeAction(action: string) {
  return action
    .split(".")
    .map((part) => part.replaceAll("_", " "))
    .join(" · ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function changedFields(entry: AuditEvent) {
  const before =
    entry.before && typeof entry.before === "object"
      ? (entry.before as Record<string, unknown>)
      : {};
  const after =
    entry.after && typeof entry.after === "object" ? (entry.after as Record<string, unknown>) : {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => key !== "updatedAt" && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  return keys.length
    ? `Changed: ${keys.map((key) => key.replace(/Id$/, "").replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)).join(", ")}`
    : "No field-level changes recorded.";
}
