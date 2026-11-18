import { localDateAt, localDateToIso, sameLocalDate } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import {
  EventCard,
  EventCardBody,
  EventCardContent,
  EventCardDescription,
  EventCardPrimaryAction,
  EventCardTitle,
} from "../../components/event-card.js";
import { PinIcon } from "../../components/icons.js";
import { OccasionCard } from "../../components/occasion-card.js";
import {
  ReminderItem,
  ReminderItemCompletion,
  ReminderItemContent,
  ReminderItemPrimaryAction,
  ReminderItemTitle,
} from "../../components/reminder-item.js";
import {
  TaskItem,
  TaskItemCompletion,
  TaskItemContent,
  TaskItemPrimaryAction,
  TaskItemTitle,
} from "../../components/task-item.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import { ItemGroup } from "../../components/ui/item.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Toaster } from "../../components/ui/sonner.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { SettingsFeedbackContext, useSettingsError } from "../../lib/settings-feedback.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { DayTimeline } from "../calendar/day-timeline.js";
import { calendarEventColorStyle } from "../calendar/event-color.js";
import { PetSectionScroll } from "./pet-section-scroll.js";

type WorkItem = {
  id: string;
  title: string;
  dueAt?: string;
  group?: "overdue" | "upcoming" | "undated";
};
type ContentRange = { label: string; timeZone: string };
type WorkContent = { items: WorkItem[]; partial: boolean; range: ContentRange };
type MoneyFact = {
  currency: string;
  cents: number | null;
  quality: "verified" | "qualified" | "unavailable";
  reasons: string[];
};
type RitualCard = {
  id: string;
  kind: string;
  logicalDate: string;
  status: string;
  urgent: boolean;
  canOpen: boolean;
  stale: boolean;
  syncStatus: string;
};
type EventItem = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  conferenceUrl?: string;
  calendarId?: string;
  provider?: string;
};
export type PetData = {
  contentError?: string;
  content?: {
    unavailable?: boolean;
    errors?: Partial<Record<"tasks" | "reminders" | "finances" | "rituals", boolean>>;
    rituals?: RitualCard[];
    tasks?: WorkContent;
    reminders?: WorkContent;
    finances?: { range: ContentRange; facts?: MoneyFact[]; unavailable?: string };
  };
  presentation?: { pinned: boolean; visible: boolean; revision?: number };
  workspaces: string[];
  snapshot: null | {
    serverUrl: string;
    accountId: string;
    generatedAt: string;
    stale: boolean;
    timeZone: string;
    tasks: WorkItem[];
    reminders: WorkItem[];
    events: EventItem[];
    financeSummary?: string;
  };
};
const act = (value: Record<string, unknown>) => invoke("pet_action", { value });
function IconAction({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={pressed ? "secondary" : "ghost"}
          size="icon"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
export function PetOverlay() {
  return (
    <SettingsFeedbackContext.Provider value={true}>
      <TooltipProvider>
        <PetContent />
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </SettingsFeedbackContext.Provider>
  );
}
function PetContent() {
  const cache = useQueryClient();
  const [visible, setVisible] = useState(true);
  const [pinned, setPinned] = useState(false);
  const presentationRevision = useRef(-1);
  const [presentationError, setPresentationError] = useState<unknown>();
  const [now, setNow] = useState(() => new Date());
  const data = useQuery({
    enabled: visible,
    queryKey: ["pet-snapshot"],
    queryFn: () => invoke<PetData>("pet_snapshot"),
    refetchInterval: false,
    retry: false,
  });
  const me = useQuery({ queryKey: ["me"], queryFn: api.getMe, retry: false });
  const calendarEnabled =
    visible && !!data.data?.snapshot && !!data.data?.workspaces.includes("calendar");
  const calendars = useQuery({
    queryKey: ["pet-calendars", data.data?.snapshot?.serverUrl, data.data?.snapshot?.accountId],
    queryFn: api.listCalendars,
    enabled: calendarEnabled,
    staleTime: 60_000,
    retry: false,
  });
  const calendarColors = new Map(calendars.data?.map((calendar) => [calendar.id, calendar.color]));
  const rawSnapshot = data.data?.snapshot;
  const snapshot = rawSnapshot
    ? { ...rawSnapshot, stale: rawSnapshot.stale || data.isError || !!data.data?.contentError }
    : rawSnapshot;
  useEffect(() => {
    if (
      data.data?.presentation &&
      (data.data.presentation.revision ?? 0) >= presentationRevision.current
    ) {
      presentationRevision.current = data.data.presentation.revision ?? 0;
      setPinned(data.data.presentation.pinned);
      setVisible(data.data.presentation.visible);
    }
  }, [data.data?.presentation]);
  useEffect(() => {
    let disposed = false;
    const subscription = listen<{ pinned: boolean; visible: boolean; revision?: number }>(
      "pet-presentation",
      ({ payload }) => {
        if (disposed || (payload.revision ?? 0) < presentationRevision.current) return;
        presentationRevision.current = payload.revision ?? 0;
        setPinned(payload.pinned);
        setVisible(payload.visible);
        if (payload.visible) {
          setNow(new Date());
          void cache.invalidateQueries({ queryKey: ["pet-snapshot"] }, { cancelRefetch: false });
        }
      },
    ).catch(setPresentationError);
    return () => {
      disposed = true;
      void subscription.then((stop) => stop?.());
    };
  }, [cache]);
  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [visible]);
  useEffect(() => {
    let disposed = false;
    const subscription = listen("pet-snapshot-changed", () => {
      if (!disposed)
        void cache.invalidateQueries({ queryKey: ["pet-snapshot"] }, { cancelRefetch: false });
    }).catch(setPresentationError);
    return () => {
      disposed = true;
      void subscription.then((stop) => stop?.());
    };
  }, [cache]);
  const snapshotKey = `${snapshot?.serverUrl}:${snapshot?.accountId}:${snapshot?.generatedAt}`;
  const [completed, setCompleted] = useState({ snapshotKey, ids: [] as string[] });
  const action = useFeedbackMutation({
    feedback: { action: "complete the quick-access action" },
    mutationFn: act,
    onSuccess: (_result, value) => {
      if (value.action === "ready")
        void cache.invalidateQueries({ queryKey: ["pet-snapshot"] }, { cancelRefetch: false });
    },
  });
  const complete = useFeedbackMutation({
    feedback: { action: "complete this item" },
    mutationFn: ({ kind, id }: { kind: string; id: string }) => {
      if (!snapshot || snapshot.stale) throw new Error("Reconnect before completing this item.");
      return act({
        action: "complete",
        kind,
        id,
        serverUrl: snapshot.serverUrl,
        accountId: snapshot.accountId,
      });
    },
    onSuccess: (_result, { kind, id }) => {
      setCompleted((previous) => ({
        snapshotKey,
        ids: [...(previous.snapshotKey === snapshotKey ? previous.ids : []), `${kind}:${id}`],
      }));
    },
  });
  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => {
      void act({ action: "refresh" })
        .then(() =>
          cache.invalidateQueries({ queryKey: ["pet-snapshot"] }, { cancelRefetch: false }),
        )
        .catch(setPresentationError);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [visible, cache]);
  const pin = useFeedbackMutation({
    feedback: { action: "pin quick access" },
    mutationFn: (value: boolean) => act({ action: "pin", pinned: value }),
    onSuccess: (_result, value) => setPinned(value),
  });
  useSettingsError(presentationError, "Couldn’t sync the pet window. Try reopening quick access.");
  useSettingsError(
    data.data?.contentError,
    "Couldn’t refresh quick-access content. It will retry automatically.",
  );
  const sectionErrors = data.data?.content?.errors;
  useSettingsError(
    sectionErrors?.tasks,
    "Couldn’t refresh pet tasks. They will retry automatically.",
  );
  useSettingsError(
    sectionErrors?.reminders,
    "Couldn’t refresh pet reminders. They will retry automatically.",
  );
  useSettingsError(
    sectionErrors?.finances,
    "Couldn’t refresh pet finances. They will retry automatically.",
  );
  useSettingsError(
    sectionErrors?.rituals,
    "Couldn’t refresh pet rituals. They will retry automatically.",
  );
  useSettingsError(data.error, "Couldn’t load quick access. It will retry automatically.");
  useSettingsError(
    calendarEnabled ? calendars.error : null,
    "Couldn’t refresh calendar colors. Try reopening quick access.",
  );
  useSettingsError(me.error, "Couldn’t refresh your account. Open nohmi to reconnect.");
  useEffect(() => {
    const theme = me.data?.theme ?? "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [me.data?.theme]);
  const actionRef = useRef(action.mutate);
  actionRef.current = action.mutate;
  useEffect(() => {
    actionRef.current({ action: "ready" });
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") actionRef.current({ action: "close" });
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);
  const drag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    action.mutate({ action: "drag" });
  };
  const open = (path: string) => action.mutate({ action: "open", path });
  const time = (value: string) =>
    new Date(value).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      timeZone: snapshot?.timeZone,
    });
  const eventDateZone = (event: EventItem) =>
    event.provider && event.provider !== "local" ? "UTC" : (snapshot?.timeZone ?? "UTC");
  const events =
    snapshot?.events.filter((event) => {
      if (event.allDay) {
        const today = localDateToIso(localDateAt(now, snapshot.timeZone));
        const start = localDateToIso(localDateAt(new Date(event.startsAt), eventDateZone(event)));
        const end = localDateToIso(
          localDateAt(new Date(new Date(event.endsAt).getTime() - 1), eventDateZone(event)),
        );
        return start <= today && today <= end;
      }
      return (
        new Date(event.endsAt) > now &&
        (new Date(event.startsAt) <= now ||
          sameLocalDate(
            localDateAt(new Date(event.startsAt), snapshot.timeZone),
            localDateAt(now, snapshot.timeZone),
          ))
      );
    }) ?? [];
  const calendar =
    snapshot && data.data?.workspaces.includes("calendar") ? (
      <section
        data-pet-scroll-anchor
        aria-label="Today's calendar"
        className="flex shrink-0 flex-col gap-3"
      >
        <h2 className="text-sm font-medium">Your timeline</h2>
        <ItemGroup className="today-all-day-strip__events">
          {events
            .filter((event) => event.allDay)
            .map((event) => {
              const start = localDateAt(new Date(event.startsAt), eventDateZone(event));
              const end = localDateAt(
                new Date(new Date(event.endsAt).getTime() - 1),
                eventDateZone(event),
              );
              const label = (date: typeof start) =>
                new Intl.DateTimeFormat("en", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
              return (
                <li key={event.id}>
                  <OccasionCard
                    accentColor={calendarColors.get(event.calendarId ?? "") ?? "#777ce3"}
                    startDateTime={localDateToIso(start)}
                    endDateTime={localDateToIso(end)}
                    startLabel={label(start)}
                    endLabel={label(end)}
                    title={event.title}
                    onOpen={() => open("/calendar")}
                  />
                </li>
              );
            })}
        </ItemGroup>
        {events.some((event) => !event.allDay) ? (
          <div className="px-2 py-3" data-no-drag="true">
            <DayTimeline
              currentTime={now}
              items={events.filter((event) => !event.allDay)}
              timeZone={snapshot.timeZone}
              renderItem={(event, style, density) => (
                <EventCard
                  key={event.id}
                  role="listitem"
                  className="today-timeline__event"
                  data-density={density}
                  tone="calendar"
                  style={{
                    ...calendarEventColorStyle(calendarColors.get(event.calendarId ?? "")),
                    ...style,
                  }}
                >
                  <EventCardContent>
                    <EventCardPrimaryAction
                      className="today-timeline__event-action"
                      onClick={() => open("/calendar")}
                    >
                      <EventCardBody>
                        <EventCardTitle>{event.title}</EventCardTitle>
                        <EventCardDescription>
                          {time(event.startsAt)}–{time(event.endsAt)}
                        </EventCardDescription>
                      </EventCardBody>
                    </EventCardPrimaryAction>
                    {event.conferenceUrl?.startsWith("https://") ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Join ${event.title}`}
                        onClick={() =>
                          action.mutate({
                            action: "join",
                            url: event.conferenceUrl,
                            serverUrl: snapshot.serverUrl,
                            accountId: snapshot.accountId,
                          })
                        }
                      >
                        Join
                      </Button>
                    ) : null}
                  </EventCardContent>
                </EventCard>
              )}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No upcoming events today.</p>
        )}
      </section>
    ) : null;
  function work(
    items: WorkItem[],
    kind: "task" | "reminder",
    title: string,
    content?: WorkContent,
  ) {
    const Item = kind === "task" ? TaskItem : ReminderItem;
    const Completion = kind === "task" ? TaskItemCompletion : ReminderItemCompletion;
    const PrimaryAction = kind === "task" ? TaskItemPrimaryAction : ReminderItemPrimaryAction;
    const Content = kind === "task" ? TaskItemContent : ReminderItemContent;
    const Title = kind === "task" ? TaskItemTitle : ReminderItemTitle;
    const visible = (content?.items ?? items).filter(
      (item) =>
        !(completed.snapshotKey === snapshotKey && completed.ids.includes(`${kind}:${item.id}`)),
    );
    return (
      <Card data-pet-scroll-anchor className="shrink-0">
        <CardHeader>
          <CardTitle>
            <h2 className="flex flex-wrap items-baseline gap-x-1.5">
              <span>{title}</span>
              {content ? (
                <span className="text-sm font-normal text-muted-foreground">
                  {content.range.label === "All upcoming"
                    ? "all upcoming"
                    : `due ${content.range.label.toLowerCase()}`}
                </span>
              ) : null}
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visible.length ? (
            <ItemGroup>
              {visible.map((item, index) => (
                <Item key={item.id}>
                  {item.group && item.group !== visible[index - 1]?.group ? (
                    <h3 className="w-full text-xs font-medium text-muted-foreground">
                      {item.group === "undated"
                        ? "Undated"
                        : item.group === "overdue"
                          ? "Overdue"
                          : "Upcoming"}
                    </h3>
                  ) : null}
                  <Completion>
                    <Checkbox
                      aria-label={`Complete ${item.title}`}
                      checked={false}
                      disabled={snapshot?.stale || complete.isPending}
                      onCheckedChange={() => complete.mutate({ kind, id: item.id })}
                    />
                  </Completion>
                  <PrimaryAction
                    aria-label={`Open ${item.title}`}
                    onClick={() => open(kind === "task" ? "/tasks" : "/reminders")}
                  >
                    <Content>
                      <Title>{item.title}</Title>
                    </Content>
                  </PrimaryAction>
                </Item>
              ))}
            </ItemGroup>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing in this date window.</p>
          )}
          {content?.partial ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Showing a limited result.{" "}
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => open(kind === "task" ? "/tasks" : "/reminders")}
              >
                View all {title.toLowerCase()}
              </Button>
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }
  const finance = data.data?.content?.finances;
  const rituals = (urgent: boolean) =>
    data.data?.content?.rituals
      ?.filter((ritual) => ritual.urgent === urgent)
      .map((ritual) => (
        <Card data-pet-scroll-anchor key={ritual.id} className="shrink-0 gap-2 py-3">
          <CardHeader className="px-3">
            <CardTitle>{ritual.kind === "morning" ? "Morning ritual" : "Night ritual"}</CardTitle>
            <CardDescription>
              {ritual.stale || snapshot?.stale ? "Status needs refreshing" : ritual.status}
              {ritual.syncStatus !== "saved" ? " · Waiting to sync" : ""}
            </CardDescription>
          </CardHeader>
          {ritual.canOpen && snapshot ? (
            <CardContent className="px-3">
              <Button
                variant="secondary"
                disabled={action.isPending || snapshot.stale}
                aria-label={`Open ${ritual.kind} ritual`}
                onClick={() =>
                  action.mutate({
                    action: "ritual",
                    occurrenceId: ritual.id,
                    serverUrl: snapshot.serverUrl,
                    accountId: snapshot.accountId,
                  })
                }
              >
                Open ritual
              </Button>
            </CardContent>
          ) : null}
        </Card>
      ));
  return (
    <main
      role="dialog"
      aria-label="Pet quick access"
      className="relative flex h-dvh min-w-0 flex-col"
      onPointerDown={(event) => {
        if (
          event.target instanceof Element &&
          !event.target.closest(
            'button, a, input, select, textarea, label, [role="checkbox"], [role="menu"], [data-no-drag], [data-slot="scroll-area-scrollbar"], [contenteditable="true"]',
          )
        )
          drag(event);
      }}
    >
      <PetSectionScroll>
        <header data-pet-scroll-anchor className="flex shrink-0 items-center justify-between gap-2">
          <div
            className="min-w-0 cursor-grab"
            onPointerDown={(event) => {
              if (!(event.target instanceof Element) || event.target.closest("button, a, input"))
                return;
              drag(event);
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  className="-ms-2.5 cursor-grab text-base"
                  aria-label="Move pet card"
                  onPointerDown={drag}
                  onKeyDown={(event) => {
                    const movement = {
                      ArrowLeft: [-20, 0],
                      ArrowRight: [20, 0],
                      ArrowUp: [0, 20],
                      ArrowDown: [0, -20],
                    }[event.key];
                    if (!movement) return;
                    event.preventDefault();
                    action.mutate({ action: "move", dx: movement[0], dy: movement[1] });
                  }}
                >
                  Today
                </Button>
              </TooltipTrigger>
              <TooltipContent>Drag to move, or use the arrow keys.</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex shrink-0 gap-1">
            <IconAction
              label={pinned ? "Unpin quick access" : "Pin quick access"}
              disabled={pin.isPending}
              pressed={pinned}
              onClick={() => pin.mutate(!pinned)}
            >
              <PinIcon weight={pinned ? "Filled" : "Outline"} />
            </IconAction>
            <IconAction label="Open nohmi" onClick={() => open("/today")}>
              <img src="/icon.svg" alt="" className="size-6 rounded-md" />
            </IconAction>
          </div>
        </header>
        {data.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : data.isError && !snapshot ? null : !snapshot ? (
          <Card data-pet-scroll-anchor className="shrink-0">
            <CardHeader>
              <CardTitle>Sign in to see your day</CardTitle>
              <CardDescription>Open nohmi to connect your account.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            {rituals(true)}
            {calendar}
            {rituals(false)}
            {!data.data?.content?.unavailable &&
            !sectionErrors?.tasks &&
            data.data?.workspaces.includes("tasks")
              ? work(snapshot.tasks, "task", "Tasks", data.data?.content?.tasks)
              : null}
            {!data.data?.content?.unavailable &&
            !sectionErrors?.reminders &&
            data.data?.workspaces.includes("reminders")
              ? work(snapshot.reminders, "reminder", "Reminders", data.data?.content?.reminders)
              : null}
            {!sectionErrors?.finances &&
            data.data?.workspaces.includes("finances") &&
            (finance || snapshot.financeSummary) ? (
              <Card data-pet-scroll-anchor className="shrink-0">
                <CardHeader>
                  <CardTitle>Finances</CardTitle>
                  {finance ? (
                    <CardDescription>Posted spending · {finance.range.label}</CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {finance
                    ? (finance.unavailable ??
                      finance.facts?.map((fact) => (
                        <div key={fact.currency} className="space-y-1">
                          <p>
                            {fact.cents === null || fact.quality === "unavailable"
                              ? "Spending unavailable"
                              : new Intl.NumberFormat(undefined, {
                                  style: "currency",
                                  currency: fact.currency,
                                }).format(fact.cents / 100)}
                          </p>
                          {fact.quality !== "verified" ? (
                            <p className="text-xs text-muted-foreground">
                              {fact.quality === "qualified"
                                ? "Qualified total"
                                : "Incomplete evidence"}{" "}
                              ·{" "}
                              {fact.reasons.map((reason) => reason.replaceAll("_", " ")).join(", ")}
                            </p>
                          ) : null}
                        </div>
                      )))
                    : snapshot.financeSummary}
                </CardContent>
              </Card>
            ) : null}
          </>
        )}
      </PetSectionScroll>
      {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((edge) => (
        <button
          key={edge}
          type="button"
          tabIndex={edge === "se" ? 0 : -1}
          aria-hidden={edge !== "se"}
          aria-label="Resize pet card"
          data-no-drag="true"
          className={`pet-resize pet-resize--${edge} focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring`}
          onKeyDown={(event) => {
            const sizes = {
              ArrowLeft: [-20, 0],
              ArrowRight: [20, 0],
              ArrowUp: [0, 20],
              ArrowDown: [0, -20],
            }[event.key];
            if (!sizes) return;
            event.preventDefault();
            event.stopPropagation();
            action.mutate({ action: "resize", dw: sizes[0], dh: sizes[1] });
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            action.mutate({ action: "resize", edge });
          }}
        />
      ))}
    </main>
  );
}
