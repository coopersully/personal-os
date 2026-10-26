import { ApiClientError } from "@personal-os/api-client";
import {
  type FinanceActivityEntry as ActivityEntry,
  type FinanceActivityPage as FinanceActivityPageData,
  type FinanceActivityQuery,
  financeActivityQuerySchema,
} from "@personal-os/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AgentIdentity } from "@/components/agent-identity";
import { ContentSkeleton } from "@/components/content-skeleton";
import { DataTable } from "@/components/data-table";
import { DateDisplay } from "@/components/date-display";
import { FilterIcon, RefreshIcon } from "@/components/icons";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/responsive-dialog";
import { TablePagination } from "@/components/table-pagination";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ItemGroup } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import { FinanceActivityEntry, type ReadFinanceActivityEvidence } from "./activity-entry";

type Props = {
  ownerId: string;
  readActivity: (query: FinanceActivityQuery) => Promise<FinanceActivityPageData>;
  readEvidence?: ReadFinanceActivityEvidence;
};
export function groupFinanceActivity(entries: ActivityEntry[]) {
  const result: Array<{
    key: string;
    entries: ActivityEntry[];
    family: string | null;
    runId: string | null;
  }> = [];
  for (const entry of entries) {
    const grouped =
      entry.kind === "financial_action" &&
      entry.actor.type === "agent" &&
      entry.runId &&
      entry.effect?.significance === "routine" &&
      entry.effect.actionFamilies.length === 1;
    const family = grouped ? (entry.effect?.actionFamilies[0] ?? null) : null;
    const key = grouped ? `run:${entry.runId}:${family}` : entry.id;
    const existing = grouped ? result.find((group) => group.key === key) : undefined;
    if (existing) existing.entries.push(entry);
    else result.push({ key, entries: [entry], family, runId: entry.runId });
  }
  return result;
}

function sharedActivityAccount(entries: ActivityEntry[]) {
  const account = entries[0]?.agentAccount;
  return account && entries.every((entry) => entry.agentAccount?.id === account.id)
    ? account
    : null;
}

// Remount on ownership changes so neither old results nor in-flight reads cross owners.
export function FinanceActivityPage(props: Props) {
  return <Activity key={props.ownerId} {...props} />;
}

function Activity({ ownerId, readActivity, readEvidence }: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<ReturnType<typeof groupFinanceActivity>[number] | null>(
    null,
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([]);
  const [page, setPage] = useState<FinanceActivityPageData>();
  const [query, setQuery] = useState<FinanceActivityQuery>({ limit: 50 });
  const [pending, setPending] = useState(false);
  const [passiveLoading, setPassiveLoading] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const actionToast = useRef<string | number | undefined>(undefined);
  const reader = useRef(readActivity);
  reader.current = readActivity;

  const clearAccess = useCallback(() => {
    setPage(undefined);
    setSelected(null);
    setFiltersOpen(false);
    setPageIndex(0);
    setCursorHistory([]);
    setQuery({ limit: 50 });
    setPending(false);
    setPassiveLoading(false);
    setAttempted(true);
    actionToast.current = undefined;
    generation.current += 1;
  }, []);
  const load = useCallback(
    async (next: FinanceActivityQuery, append: boolean, explicit: boolean) => {
      const request = ++generation.current;
      setPending(true);
      setPassiveLoading(!explicit);
      const toastId = explicit
        ? toast.loading(append ? "Loading more activity…" : "Loading activity…")
        : undefined;
      actionToast.current = toastId;
      try {
        const result = await reader.current(next);
        if (!alive.current || generation.current !== request) {
          if (toastId !== undefined) toast.dismiss(toastId);
          return;
        }
        setPage(result);
        setQuery(next);
        if (toastId !== undefined) toast.success("Activity loaded", { id: toastId });
        return true;
      } catch (error) {
        if (!alive.current || generation.current !== request) {
          if (toastId !== undefined) toast.dismiss(toastId);
          return;
        }
        const accessDenied =
          error instanceof ApiClientError && (error.status === 401 || error.status === 403);
        if (accessDenied) {
          // A retained page is no longer authorized, even when owner identity has not changed.
          clearAccess();
        }
        toast.error(
          accessDenied
            ? "Activity access is unavailable. Sign in or check your permissions."
            : "Could not load activity. Try again.",
          toastId === undefined ? undefined : { id: toastId },
        );
      } finally {
        if (alive.current && generation.current === request) {
          actionToast.current = undefined;
          setPending(false);
          setPassiveLoading(false);
          setAttempted(true);
        }
      }
    },
    [clearAccess],
  );

  useEffect(() => {
    alive.current = true;
    void load({ limit: 50 }, false, false);
    return () => {
      alive.current = false;
      if (actionToast.current !== undefined) toast.dismiss(actionToast.current);
      generation.current += 1;
    };
  }, [load]);

  const coverage = page ? (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="justify-self-start text-muted-foreground">
          Partial history
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <section
          aria-label="Activity coverage"
          className="grid gap-1 text-sm text-muted-foreground"
        >
          <p>
            {page.capabilities.financialActions.state === "available"
              ? "Partial history · Includes applied changes with committed candidate receipts. Other financial actions and no-change runs are not covered."
              : "Partial history · Financial action evidence is not integrated. Applied money changes are not covered here."}
          </p>
          {page.coverage.reasons.includes(
            "committed_receipts_with_incomplete_evidence_not_projected",
          ) ? (
            <p>Some committed receipts have incomplete supporting evidence and are omitted.</p>
          ) : null}
          {page.coverage.reasons.includes(
            "historical_decisions_without_causal_message_not_projected",
          ) ? (
            <p>Historical decisions without an immutable source message are omitted.</p>
          ) : null}
        </section>
      </CollapsibleContent>
    </Collapsible>
  ) : null;

  return (
    <div className="grid min-w-0 gap-4">
      <ResponsiveDialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <WorkspaceHeaderControls label="Activity controls">
          <ResponsiveDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Activity filters"
              title="Activity filters"
            >
              <FilterIcon aria-hidden="true" />
            </Button>
          </ResponsiveDialogTrigger>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh activity"
            title="Refresh activity"
            disabled={pending}
            onClick={() => void load(query, false, true)}
          >
            <RefreshIcon aria-hidden="true" />
          </Button>
        </WorkspaceHeaderControls>
        <ResponsiveDialogContent data-finance-dialog data-finance-size="default">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Filter activity</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Narrow recorded activity by type, actor, record, or date.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const value = (name: string) => String(form.get(name) ?? "");
                const result = financeActivityQuerySchema.safeParse({
                  limit: pageSize,
                  ...(value("type") ? { type: value("type") } : {}),
                  ...(value("actor") ? { actor: value("actor") } : {}),
                  ...(value("record") ? { recordId: value("record").trim() } : {}),
                  ...(value("from") ? { from: `${value("from")}T00:00:00.000Z` } : {}),
                  ...(value("through") ? { through: `${value("through")}T23:59:59.999Z` } : {}),
                });
                if (!result.success) {
                  toast.error("Check the filters and date range.");
                  return;
                }
                void load(result.data, false, true).then((loaded) => {
                  if (loaded) {
                    setFiltersOpen(false);
                    setCursorHistory([]);
                    setPageIndex(0);
                  }
                });
              }}
            >
              <label className="grid gap-1 text-sm" htmlFor="activity-type">
                Event type
                <NativeSelect id="activity-type" name="type" defaultValue={query.type ?? ""}>
                  <NativeSelectOption value="">All types</NativeSelectOption>
                  <NativeSelectOption value="human_answer_decision">
                    Human decisions
                  </NativeSelectOption>
                  <NativeSelectOption value="financial_action">
                    Financial actions
                  </NativeSelectOption>
                </NativeSelect>
              </label>
              <label className="grid gap-1 text-sm" htmlFor="activity-actor">
                Actor
                <NativeSelect id="activity-actor" name="actor" defaultValue={query.actor ?? ""}>
                  <NativeSelectOption value="">All actors</NativeSelectOption>
                  {["user", "agent", "connector", "system"].map((actor) => (
                    <NativeSelectOption key={actor} value={actor}>
                      {actor}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="grid min-w-0 gap-1 text-sm sm:col-span-2" htmlFor="activity-record">
                Record ID
                <Input
                  id="activity-record"
                  name="record"
                  maxLength={240}
                  defaultValue={query.recordId ?? ""}
                />
              </label>
              <label className="grid gap-1 text-sm" htmlFor="activity-from">
                From (UTC)
                <Input
                  id="activity-from"
                  name="from"
                  type="date"
                  defaultValue={query.from?.slice(0, 10) ?? ""}
                />
              </label>
              <label className="grid gap-1 text-sm" htmlFor="activity-through">
                Through (UTC)
                <Input
                  id="activity-through"
                  name="through"
                  type="date"
                  defaultValue={query.through?.slice(0, 10) ?? ""}
                />
              </label>
              <ResponsiveDialogFooter className="sm:col-span-2">
                <Button type="button" variant="outline" onClick={() => setFiltersOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  Apply filters
                </Button>
              </ResponsiveDialogFooter>
            </form>
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      {passiveLoading && !page ? <ContentSkeleton label="Loading activity…" rows={3} /> : null}
      {page?.entries.length === 0 ? (
        <p>No recorded activity matches these filters. Coverage is partial.</p>
      ) : null}
      {page ? (
        <>
          <DataTable
            rows={groupFinanceActivity(page.entries)}
            columns={[
              {
                id: "date",
                label: "Date",
                width: 140,
                value: (group) => group.entries[0]?.occurredAt ?? "",
                cell: (group) => <DateDisplay value={group.entries[0]?.occurredAt ?? ""} />,
              },
              {
                id: "summary",
                label: "Activity",
                width: 500,
                primary: true,
                value: (group) =>
                  group.family && group.entries.length > 1
                    ? `${group.family.replaceAll("_", " ")} · ${group.entries.length} actions`
                    : (group.entries[0]?.action ?? ""),
                cell: (group) => (
                  <span className="grid gap-1">
                    <span>
                      {group.family && group.entries.length > 1
                        ? `${group.family.replaceAll("_", " ")} · ${group.entries.length} actions`
                        : group.entries[0]?.action}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {group.entries[0]?.explanation}
                    </span>
                  </span>
                ),
              },
              {
                id: "actor",
                label: "Actor",
                width: 100,
                value: (group) =>
                  sharedActivityAccount(group.entries)?.displayName ??
                  group.entries[0]?.actor.type ??
                  "",
                cell: (group) => {
                  const account = sharedActivityAccount(group.entries);
                  return account ? (
                    <AgentIdentity account={account} />
                  ) : (
                    group.entries[0]?.actor.type
                  );
                },
              },
              {
                id: "status",
                label: "Status",
                width: 100,
                value: (group) => group.entries[0]?.status ?? "",
              },
            ]}
            rowId={(group) => group.key}
            rowLabel={(group) => `Open activity: ${group.entries[0]?.explanation ?? "Details"}`}
            onOpen={setSelected}
            storageKey={`${ownerId}:finance-activity`}
            label="Financial activity"
            fileName="finance-activity.csv"
            caption={coverage}
          />
          <TablePagination
            pageIndex={pageIndex}
            pageSize={pageSize}
            count={page.entries.length}
            hasNext={!!page.nextCursor}
            pending={pending}
            onPrevious={async () => {
              const cursor = cursorHistory.at(-1);
              if (await load({ ...query, cursor }, false, true)) {
                setCursorHistory((history) => history.slice(0, -1));
                setPageIndex((index) => Math.max(0, index - 1));
              }
            }}
            onNext={async () => {
              if (
                page.nextCursor &&
                (await load({ ...query, cursor: page.nextCursor }, true, true))
              ) {
                setCursorHistory((history) => [...history, query.cursor]);
                setPageIndex((index) => index + 1);
              }
            }}
            onPageSizeChange={async (size) => {
              if (await load({ ...query, cursor: undefined, limit: size }, false, true)) {
                setPageSize(size);
                setPageIndex(0);
                setCursorHistory([]);
              }
            }}
          />
        </>
      ) : null}
      {selected ? (
        <ResponsiveDialog
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        >
          <ResponsiveDialogContent data-finance-dialog data-finance-size="default">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Activity details</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Review the recorded changes and their supporting evidence.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody>
              <ItemGroup className="gap-3">
                {selected.entries.map((entry) => (
                  <FinanceActivityEntry
                    key={entry.id}
                    entry={entry}
                    readEvidence={readEvidence}
                    onAccessDenied={clearAccess}
                  />
                ))}
              </ItemGroup>
            </ResponsiveDialogBody>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      ) : null}
      {attempted && !page && !pending ? (
        <Button className="justify-self-start" onClick={() => void load(query, false, true)}>
          Retry activity
        </Button>
      ) : null}
    </div>
  );
}
