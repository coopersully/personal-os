import { ApiClientError } from "@personal-os/api-client";
import {
  type FinanceActivityEntry as ActivityEntry,
  type FinanceActivityPage as FinanceActivityPageData,
  type FinanceActivityQuery,
  financeActivityQuerySchema,
} from "@personal-os/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemGroup } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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

// Remount on ownership changes so neither old results nor in-flight reads cross owners.
export function FinanceActivityPage(props: Props) {
  return <Activity key={props.ownerId} {...props} />;
}

function Activity({ readActivity, readEvidence }: Props) {
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
        setPage((previous) =>
          append && previous
            ? {
                ...result,
                entries: [
                  ...previous.entries,
                  ...result.entries.filter(
                    (entry) => !previous.entries.some((old) => old.id === entry.id),
                  ),
                ],
              }
            : result,
        );
        setQuery({ ...next, cursor: undefined });
        if (toastId !== undefined) toast.success("Activity loaded", { id: toastId });
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

  return (
    <div className="grid min-w-0 gap-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const value = (name: string) => String(form.get(name) ?? "");
          const result = financeActivityQuerySchema.safeParse({
            limit: 50,
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
          void load(result.data, false, true);
        }}
      >
        <label className="grid gap-1 text-sm" htmlFor="activity-type">
          Event type
          <NativeSelect id="activity-type" name="type">
            <NativeSelectOption value="">All types</NativeSelectOption>
            <NativeSelectOption value="human_answer_decision">Human decisions</NativeSelectOption>
            <NativeSelectOption value="financial_action">Financial actions</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm" htmlFor="activity-actor">
          Actor
          <NativeSelect id="activity-actor" name="actor">
            <NativeSelectOption value="">All actors</NativeSelectOption>
            {["user", "agent", "connector", "system"].map((actor) => (
              <NativeSelectOption key={actor} value={actor}>
                {actor}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="grid min-w-0 gap-1 text-sm" htmlFor="activity-record">
          Record ID
          <Input id="activity-record" name="record" maxLength={240} />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="activity-from">
          From (UTC)
          <Input id="activity-from" name="from" type="date" />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="activity-through">
          Through (UTC)
          <Input id="activity-through" name="through" type="date" />
        </label>
        <Button type="submit" disabled={pending}>
          Apply filters
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => void load(query, false, true)}
        >
          Refresh activity
        </Button>
      </form>
      {page ? (
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
      ) : null}
      {passiveLoading && !page ? <p>Loading activity…</p> : null}
      {page?.entries.length === 0 ? (
        <p>No recorded activity matches these filters. Coverage is partial.</p>
      ) : null}
      <ItemGroup aria-label="Financial activity">
        {groupFinanceActivity(page?.entries ?? []).map((group) =>
          group.family && group.entries.length > 1 ? (
            <Item key={group.key} variant="outline" role="listitem">
              <ItemContent>
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost">
                      {group.family.replaceAll("_", " ")} · {group.entries.length} actions
                    </Button>
                  </CollapsibleTrigger>
                  <p className="text-xs text-muted-foreground break-all">Run · {group.runId}</p>
                  <CollapsibleContent>
                    <ItemGroup className="mt-3 gap-3">
                      {group.entries.map((entry) => (
                        <FinanceActivityEntry
                          key={`${entry.id}:${entry.evidence?.nextCursor ?? entry.occurredAt}`}
                          nested
                          entry={entry}
                          readEvidence={readEvidence}
                          onAccessDenied={clearAccess}
                        />
                      ))}
                    </ItemGroup>
                  </CollapsibleContent>
                </Collapsible>
              </ItemContent>
            </Item>
          ) : (
            group.entries.map((entry) => (
              <FinanceActivityEntry
                key={`${entry.id}:${entry.evidence?.nextCursor ?? entry.occurredAt}`}
                entry={entry}
                readEvidence={readEvidence}
                onAccessDenied={clearAccess}
              />
            ))
          ),
        )}
      </ItemGroup>
      {page?.nextCursor ? (
        <Button
          className="justify-self-start"
          variant="ghost"
          disabled={pending}
          onClick={() => void load({ ...query, cursor: page.nextCursor ?? undefined }, true, true)}
        >
          Load more activity
        </Button>
      ) : null}
      {attempted && !page && !pending ? (
        <Button className="justify-self-start" onClick={() => void load(query, false, true)}>
          Retry activity
        </Button>
      ) : null}
    </div>
  );
}
