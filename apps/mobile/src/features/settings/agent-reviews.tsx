import { ApiClientError } from "@personal-os/api-client";
import type { AgentAccessWorkItem } from "@personal-os/domain";
import { useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import { Section, SectionNote } from "../../components/forms/form-rows";
import { confirm, State } from "../tasks/ui";
import { areaLabel, workItemKindLabels, workItemPriorityLabels } from "./agent-copy";
import { DetailBlock, RecordSummary } from "./agent-rows";
import { useSettingsAction, useSettingsResource } from "./data";
import { SettingsActionRow, SettingsDetailRow } from "./settings-row";

export function agentWorkItemUrl(base: string, path: string) {
  const parsed = new URL(base);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !/^\/(?![\\/])/.test(path)
  )
    throw new Error("The web review address is invalid.");
  const target = new URL(path, parsed.origin);
  if (target.origin !== parsed.origin) throw new Error("The web review address is invalid.");
  return target.toString();
}

export function AgentWorkItems() {
  const action = useSettingsAction();
  const [cursor, setCursor] = useState<string | undefined>();
  const [previous, setPrevious] = useState<AgentAccessWorkItem[]>([]);
  const context = useSettingsResource("agent-context", (api) => api.getPersonalOsContext());
  const page = useSettingsResource(`agent-work-items-${cursor ?? "root"}`, (api) =>
    api.listAgentAccessWorkItems({ limit: 10, ...(cursor ? { cursor } : {}) }),
  );
  const access = useRef({
    live: true,
    epoch: 0,
    pageBlocked: false,
    contextBlocked: false,
    items: [] as AgentAccessWorkItem[],
    nextCursor: null as string | null,
  });
  const pageDenied =
    page.error instanceof ApiClientError &&
    (page.error.status === 401 || page.error.status === 403);
  const contextDenied =
    context.error instanceof ApiClientError &&
    (context.error.status === 401 || context.error.status === 403);
  if (
    (pageDenied && !access.current.pageBlocked) ||
    (contextDenied && !access.current.contextBlocked)
  )
    access.current.epoch += 1;
  if (pageDenied) access.current.pageBlocked = true;
  else if (page.isSuccess && !page.isFetching && page.data) access.current.pageBlocked = false;
  if (contextDenied) access.current.contextBlocked = true;
  else if (context.isSuccess && !context.isFetching && context.data)
    access.current.contextBlocked = false;
  const denied = access.current.pageBlocked || access.current.contextBlocked;
  useEffect(() => {
    access.current.live = true;
    return () => {
      access.current.live = false;
    };
  }, []);
  useEffect(() => {
    if (denied) setPrevious([]);
  }, [denied]);
  // The denial latch survives retry's error reset; captured native callbacks use the live fence.
  const items = denied
    ? []
    : [
        ...new Map(
          [...previous, ...(page.data?.items ?? [])].map((item) => [item.id, item]),
        ).values(),
      ];
  access.current.items = items;
  access.current.nextCursor = denied ? null : (page.data?.nextCursor ?? null);
  const callbackEpoch = access.current.epoch;
  const canAct = () =>
    access.current.live &&
    !access.current.pageBlocked &&
    !access.current.contextBlocked &&
    access.current.epoch === callbackEpoch;
  const canOpen = (item: AgentAccessWorkItem) =>
    canAct() &&
    access.current.items.some(
      (current) => current.id === item.id && current.action?.to === item.action?.to,
    );
  const open = (item: AgentAccessWorkItem) => {
    if (!canOpen(item)) return;
    confirm(
      "Continue on the web?",
      "Open this item's existing web flow. Review and complete any action there; opening it does not approve or apply anything.",
      () => {
        if (!canOpen(item)) return;
        void action.run(async () => {
          if (!canOpen(item) || !context.data) return;
          await Linking.openURL(
            agentWorkItemUrl(context.data.links.agentAccess, item.action?.to ?? ""),
          );
        }, "Requested opening the web flow");
      },
    );
  };
  const unavailable = denied ? [] : (page.data?.unavailableDomains ?? []);
  const loaded = !denied && !!page.data;
  const more = !denied && !!page.data?.nextCursor;
  return (
    <>
      <Section title="Waiting for you">
        <SectionNote>
          Work your agents prepared that needs your decision or attention. You finish each item on
          the web; opening one from here never approves or applies anything.
        </SectionNote>
        {unavailable.length > 0 && (
          <SectionNote warning>
            Could not load {unavailable.map(areaLabel).join(", ")}. Other work remains visible.
          </SectionNote>
        )}
        {page.isPending && items.length === 0 && <State loading />}
        {loaded && items.length === 0 && (
          <SectionNote ink>
            {cursor ? "No agent work on this page." : "No agent work is waiting."}
          </SectionNote>
        )}
      </Section>
      {items.map((item) => (
        <Section
          key={item.id}
          title={`${item.domain ? areaLabel(item.domain) : "Account"} · ${workItemKindLabels[item.kind]}`}
        >
          <RecordSummary title={item.title} summary={item.summary} />
          <SettingsDetailRow
            label="Priority"
            value={workItemPriorityLabels[item.priority]}
            attention={item.priority === "blocked" || item.priority === "critical"}
          />
          {item.preview?.map((field) => (
            <DetailBlock key={field.label} label={field.label} lines={[field.value]} />
          ))}
          {item.action && context.data && (
            <SettingsActionRow
              label={`${item.action.label} on the web`}
              icon="send"
              disabled={action.pending}
              onPress={() => open(item)}
            />
          )}
        </Section>
      ))}
      {((page.isPending && items.length > 0) || page.isError || more || context.isError) && (
        <Section>
          {page.isPending && items.length > 0 && <State loading />}
          {page.isError && (
            <SettingsActionRow
              label="Retry loading agent work"
              icon="refresh"
              onPress={() => void page.refetch()}
            />
          )}
          {more && (
            <SettingsActionRow
              label="Load more agent work"
              disabled={page.isFetching}
              onPress={() => {
                if (!canAct() || access.current.nextCursor !== page.data?.nextCursor) return;
                setPrevious(access.current.items);
                setCursor(access.current.nextCursor ?? undefined);
              }}
            />
          )}
          {context.isError && (
            <SettingsActionRow
              label="Retry web review links"
              icon="refresh"
              onPress={() => void context.refetch()}
            />
          )}
        </Section>
      )}
    </>
  );
}
