import { localDateAt, sameLocalDate } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { NohmiBrandMark } from "../../components/brand-marks.js";
import {
  EventCard,
  EventCardBody,
  EventCardContent,
  EventCardDescription,
  EventCardPrimaryAction,
  EventCardTitle,
} from "../../components/event-card.js";
import { PinIcon, ResizeIcon } from "../../components/icons.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Checkbox } from "../../components/ui/checkbox.js";
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

type WorkItem = { id: string; title: string; dueAt?: string };
type EventItem = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  conferenceUrl?: string;
};
export type PetData = {
  presentation?: { pinned: boolean; visible: boolean };
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
const workspaceNames: Record<string, string> = {
  tasks: "Tasks",
  reminders: "Reminders",
  calendar: "Calendar",
  mail: "Mail",
  finances: "Finances",
  goals: "Goals",
  motives: "Motives",
};
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
          variant="ghost"
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
  const [presentationError, setPresentationError] = useState<unknown>();
  const [now, setNow] = useState(() => new Date());
  const data = useQuery({
    queryKey: ["pet-snapshot"],
    queryFn: () => invoke<PetData>("pet_snapshot"),
    refetchInterval: false,
    retry: false,
  });
  const me = useQuery({ queryKey: ["me"], queryFn: api.getMe, retry: false });
  const snapshot = data.data?.snapshot;
  useEffect(() => {
    if (data.data?.presentation) {
      setPinned(data.data.presentation.pinned);
      setVisible(data.data.presentation.visible);
    }
  }, [data.data?.presentation]);
  useEffect(() => {
    let disposed = false;
    const subscription = listen<{ pinned: boolean; visible: boolean }>(
      "pet-presentation",
      ({ payload }) => {
        if (disposed) return;
        setPinned(payload.pinned);
        setVisible(payload.visible);
        if (payload.visible) {
          setNow(new Date());
          void cache.invalidateQueries({ queryKey: ["pet-snapshot"] });
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
      if (!disposed) void cache.invalidateQueries({ queryKey: ["pet-snapshot"] });
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
      if (value.action === "ready") void cache.invalidateQueries({ queryKey: ["pet-snapshot"] });
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
        .then(() => cache.invalidateQueries({ queryKey: ["pet-snapshot"] }))
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
  useSettingsError(data.error, "Couldn’t load quick access. It will retry automatically.");
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
  const events =
    snapshot?.events.filter(
      (event) =>
        new Date(event.endsAt) > now &&
        (new Date(event.startsAt) <= now ||
          sameLocalDate(
            localDateAt(new Date(event.startsAt), snapshot.timeZone),
            localDateAt(now, snapshot.timeZone),
          )),
    ) ?? [];
  const calendar =
    snapshot && data.data?.workspaces.includes("calendar") ? (
      <section aria-label="Today's calendar" className="flex shrink-0 flex-col gap-3">
        <h2 className="text-sm font-medium">Your timeline</h2>
        {events
          .filter((event) => event.allDay)
          .map((event) => (
            <Button
              key={event.id}
              variant="secondary"
              className="justify-start"
              onClick={() => open("/calendar")}
            >
              {event.title} · All day
            </Button>
          ))}
        {events.some((event) => !event.allDay) ? (
          <div className="max-h-72 overflow-y-auto py-3" data-no-drag="true">
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
                  style={style}
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
  function work(items: WorkItem[], kind: string, title: string) {
    const visible = items.filter(
      (item) =>
        !(completed.snapshotKey === snapshotKey && completed.ids.includes(`${kind}:${item.id}`)),
    );
    return (
      <Card className="shrink-0">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {visible.length ? (
            <ul className="flex flex-col gap-3">
              {visible.map((item) => (
                <li key={item.id} className="flex items-start gap-3">
                  <Checkbox
                    className="mt-1"
                    aria-label={`Complete ${item.title}`}
                    checked={false}
                    disabled={snapshot?.stale || complete.isPending}
                    onCheckedChange={() => complete.mutate({ kind, id: item.id })}
                  />
                  <Button
                    variant="link"
                    className="h-auto min-w-0 flex-1 shrink justify-start whitespace-normal p-0 text-start wrap-anywhere"
                    onClick={() => open(kind === "task" ? "/tasks" : "/reminders")}
                  >
                    {item.title}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing due today or overdue.</p>
          )}
        </CardContent>
      </Card>
    );
  }
  return (
    <main
      role="dialog"
      aria-label="Pet quick access"
      className="relative flex h-dvh min-w-0 flex-col"
      onPointerDown={(event) => {
        if (
          event.target instanceof Element &&
          !event.target.closest(
            'button, a, input, select, textarea, label, [role="checkbox"], [role="menu"], [data-no-drag], [contenteditable="true"]',
          )
        )
          drag(event);
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl bg-background p-3">
        <Card className="shrink-0 gap-0 py-0">
          <CardHeader
            className="cursor-grab px-2 py-1"
            onPointerDown={(event) => {
              if (!(event.target instanceof Element) || event.target.closest("button, a, input"))
                return;
              drag(event);
            }}
          >
            <CardTitle>
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
            </CardTitle>
            <CardAction className="flex gap-1">
              <IconAction
                label={pinned ? "Unpin quick access" : "Pin quick access"}
                disabled={pin.isPending}
                pressed={pinned}
                onClick={() => pin.mutate(!pinned)}
              >
                <PinIcon className={pinned ? "text-primary" : undefined} />
              </IconAction>
              <IconAction label="Open nohmi" onClick={() => open("/today")}>
                <NohmiBrandMark symbol />
              </IconAction>
            </CardAction>
          </CardHeader>
        </Card>
        {data.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : data.isError && !snapshot ? null : !snapshot ? (
          <Card className="shrink-0">
            <CardHeader>
              <CardTitle>Sign in to see your day</CardTitle>
              <CardDescription>Open nohmi to connect your account.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            {calendar}
            {data.data?.workspaces.includes("tasks") ? work(snapshot.tasks, "task", "Tasks") : null}
            {data.data?.workspaces.includes("reminders")
              ? work(snapshot.reminders, "reminder", "Reminders")
              : null}
            {data.data?.workspaces.includes("finances") && snapshot.financeSummary ? (
              <Card className="shrink-0">
                <CardHeader>
                  <CardTitle>Finances</CardTitle>
                </CardHeader>
                <CardContent>{snapshot.financeSummary}</CardContent>
              </Card>
            ) : null}
            <Card className="shrink-0">
              <CardHeader>
                <CardTitle>Quick actions</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {["task", "reminder", "event"].map((kind) => (
                  <Button
                    key={kind}
                    variant="outline"
                    onClick={() => action.mutate({ action: "capture", kind })}
                  >
                    Add {kind}
                  </Button>
                ))}
              </CardContent>
              <CardFooter className="flex flex-wrap gap-2">
                {data.data?.workspaces.map((workspace) => (
                  <Button key={workspace} variant="ghost" onClick={() => open(`/${workspace}`)}>
                    {workspaceNames[workspace] ?? workspace}
                  </Button>
                ))}
              </CardFooter>
            </Card>
          </>
        )}
      </div>
      {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((edge) => (
        <div
          key={edge}
          aria-hidden="true"
          data-no-drag="true"
          className={`pet-resize pet-resize--${edge}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            action.mutate({ action: "resize", edge });
          }}
        />
      ))}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute bottom-1 right-1 z-20 size-6 cursor-nwse-resize"
            aria-label="Resize pet card"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              action.mutate({ action: "resize", edge: "se" });
            }}
            onKeyDown={(event) => {
              const sizes = {
                ArrowLeft: [-20, 0],
                ArrowRight: [20, 0],
                ArrowUp: [0, 20],
                ArrowDown: [0, -20],
              }[event.key];
              if (sizes) {
                event.preventDefault();
                action.mutate({ action: "resize", dw: sizes[0], dh: sizes[1] });
              }
            }}
          >
            <ResizeIcon aria-hidden="true" className="text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Drag to resize, or use the arrow keys.</TooltipContent>
      </Tooltip>
    </main>
  );
}
