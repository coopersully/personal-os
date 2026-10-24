import type {
  FinanceSpendingDashboard,
  FinanceSpendingGroup,
  FinanceSpendingMonthlyBudget,
} from "@personal-os/domain";
import { type HTMLMotionProps, motion, useDragControls, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon, RefreshIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatMoney } from "./format";
import { spendingGroupVisual } from "./spending-visual";

/** Invert a circular segment area. The result is height from the bottom, not a linear percent. */
export function spendingBudgetFillHeight(ratio: number) {
  const target = Math.max(
    0,
    Math.min(1, Number.isFinite(ratio) ? ratio : ratio === Number.POSITIVE_INFINITY ? 1 : 0),
  );
  if (target === 0 || target === 1) return target;
  let low = 0,
    high = 1;
  for (let iteration = 0; iteration < 40; iteration++) {
    const height = (low + high) / 2;
    const y = 1 - 2 * height;
    const area = (Math.acos(y) - y * Math.sqrt(Math.max(0, 1 - y * y))) / Math.PI;
    if (area < target) low = height;
    else high = height;
  }
  return (low + high) / 2;
}
function SpendingBubble(props: HTMLMotionProps<"button">) {
  const controls = useDragControls();
  return (
    <motion.button
      {...props}
      dragControls={controls}
      dragListener={false}
      onPointerDown={(event) => {
        props.onPointerDown?.(event);
        if (props.drag) controls.start(event, { distanceThreshold: 6 });
      }}
    />
  );
}
type MonthlyGroup = Extract<FinanceSpendingMonthlyBudget, { state: "qualified" }>["groups"][number];
function monthlyBudgetLabel(
  budget: MonthlyGroup | undefined,
  monthlyBudget?: FinanceSpendingMonthlyBudget,
) {
  const limit = budget?.budgetCents;
  if (!budget) return "Monthly budget comparison unavailable";
  if (limit === null || limit === undefined) return "No monthly budget limit";
  const overage = Math.max(0, budget.usedCents - limit);
  return `Monthly budget used ${formatMoney(budget.usedCents / 100)} of ${formatMoney(limit / 100)}${monthlyBudget?.state === "qualified" && monthlyBudget.coverage !== "complete" ? "; observed usage, incomplete history" : ""}${limit === 0 && budget.usedCents <= 0 ? "; No utilization" : ""}${overage > 0 ? `; Over budget ${formatMoney(overage / 100)}` : ""}`;
}
type Position = { x: number; y: number; radius: number };
/** Bounded deterministic relaxation; no idle simulation or offscreen animation loop. */
export function settleSpendingBubbles(nodes: Position[], pinned?: number) {
  const next = nodes.map((node) => ({ ...node }));
  for (let iteration = 0; iteration < (pinned === undefined ? 160 : 32); iteration++) {
    for (const node of pinned === undefined ? next : []) {
      node.x += (0.5 - node.x) * 0.002;
      node.y += (0.5 - node.y) * 0.002;
    }
    for (let i = 0; i < next.length; i++)
      for (let j = i + 1; j < next.length; j++) {
        const a = next[i],
          b = next[j];
        if (!a || !b) continue;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        const required = a.radius + b.radius + 0.008;
        if (distance < required) {
          const amount = (required - distance) / 2;
          const ux = distance ? dx / distance : 1;
          const uy = distance ? dy / distance : 0;
          const aShare = i === pinned ? 0 : j === pinned ? 2 : 1;
          const bShare = j === pinned ? 0 : i === pinned ? 2 : 1;
          a.x -= ux * amount * aShare;
          a.y -= uy * amount * aShare;
          b.x += ux * amount * bShare;
          b.y += uy * amount * bShare;
        }
      }
    for (const node of next) {
      node.x = Math.max(node.radius, Math.min(1 - node.radius, node.x));
      node.y = Math.max(node.radius, Math.min(1 - node.radius, node.y));
    }
  }
  if (pinned === undefined && next.length) {
    const minX = Math.min(...next.map((node) => node.x - node.radius));
    const maxX = Math.max(...next.map((node) => node.x + node.radius));
    const minY = Math.min(...next.map((node) => node.y - node.radius));
    const maxY = Math.max(...next.map((node) => node.y + node.radius));
    const dx = 0.5 - (minX + maxX) / 2;
    const dy = 0.5 - (minY + maxY) / 2;
    for (const node of next) {
      node.x += dx;
      node.y += dy;
    }
  }
  return next;
}
export function SpendingBubbles({
  groups,
  onSelect,
  layoutKey = "categories",
  monthlyBudget,
}: {
  groups: FinanceSpendingDashboard["groups"];
  onSelect: (group: FinanceSpendingGroup) => void;
  layoutKey?: string;
  monthlyBudget?: FinanceSpendingMonthlyBudget;
}) {
  const descriptionId = useId();
  const reduced = useReducedMotion();
  const dragOrigin = useRef<Position[]>([]);
  const positions = useRef(new Map<string, Position>());
  const [nodes, setNodes] = useState<Position[]>([]);
  const [width, setWidth] = useState(300);
  const container = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const visible = groups.filter((group) => group.positiveAreaCents > 0);
  const signature = visible.map((group) => `${group.id}:${group.positiveAreaCents}`).join("|");
  function reset(retain: boolean) {
    const total = visible.reduce((sum, group) => sum + group.positiveAreaCents, 0);
    const seeds = visible.map((group, index) => {
      const radius = Math.sqrt(group.positiveAreaCents / total) * 0.28;
      const saved = retain ? positions.current.get(`${layoutKey}:${group.id}`) : undefined;
      return {
        x: saved?.x ?? 0.5 + Math.cos(index * 2.4) * 0.18,
        y: saved?.y ?? 0.5 + Math.sin(index * 2.4) * 0.18,
        radius,
      };
    });
    const settled = settleSpendingBubbles(seeds);
    setNodes(settled);
    settled.forEach((node, index) => {
      positions.current.set(`${layoutKey}:${visible[index]?.id}`, node);
    });
  }
  // Each new aggregate settles once; normalized positions survive period changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: signature captures the complete aggregate geometry.
  useEffect(() => {
    reset(true);
  }, [signature, layoutKey]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth || 300);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <section aria-label="Spending bubbles" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-sm font-medium">Breakdown</p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reset bubble layout"
          title="Reset bubble layout"
          onClick={() => reset(false)}
        >
          <RefreshIcon />
        </Button>
      </div>
      <div
        ref={container}
        className="relative mx-auto aspect-square w-full max-w-lg overflow-hidden"
      >
        {visible.map((group, index) => {
          const node = nodes[index];
          if (!node) return null;
          const diameter = node.radius * width * 2;
          const visual = spendingGroupVisual(group);
          const VisualIcon = visual.Icon;
          const budget =
            monthlyBudget?.state === "qualified"
              ? monthlyBudget.groups.find((item) => item.groupId === group.id)
              : undefined;
          const limit = budget?.budgetCents;
          const hasLimit = budget !== undefined && limit !== null && limit !== undefined;
          const fill = hasLimit
            ? spendingBudgetFillHeight(
                limit === 0 ? (budget.usedCents > 0 ? 1 : 0) : budget.usedCents / limit,
              )
            : null;
          const overage = hasLimit ? Math.max(0, budget.usedCents - limit) : 0;
          const budgetLabel = monthlyBudgetLabel(budget, monthlyBudget);
          return (
            <SpendingBubble
              key={group.id}
              type="button"
              tabIndex={diameter < 44 ? -1 : 0}
              drag
              dragMomentum={false}
              dragElastic={0}
              dragConstraints={container}
              animate={{ x: (node.x - node.radius) * width, y: (node.y - node.radius) * width }}
              onPointerDown={(event) => {
                pointer.current = { x: event.clientX, y: event.clientY };
                dragged.current = false;
              }}
              onPointerMove={(event) => {
                if (
                  pointer.current &&
                  Math.hypot(
                    event.clientX - pointer.current.x,
                    event.clientY - pointer.current.y,
                  ) >= 6
                )
                  dragged.current = true;
              }}
              onDragStart={() => {
                dragOrigin.current = nodes.map((node) => ({ ...node }));
              }}
              onDrag={(_, info) => {
                dragged.current = true;
                const origin = dragOrigin.current[index];
                if (!origin) return;
                setNodes((current) =>
                  settleSpendingBubbles(
                    current.map((value, i) =>
                      i === index
                        ? {
                            ...value,
                            x: origin.x + info.offset.x / width,
                            y: origin.y + info.offset.y / width,
                          }
                        : value,
                    ),
                    index,
                  ),
                );
              }}
              onDragEnd={(_, info) => {
                dragged.current = true;
                const origin = dragOrigin.current[index] ?? node;
                const settled = settleSpendingBubbles(
                  nodes.map((value, i) =>
                    i === index
                      ? {
                          ...value,
                          x: origin.x + info.offset.x / width,
                          y: origin.y + info.offset.y / width,
                        }
                      : value,
                  ),
                );
                setNodes(settled);
                settled.forEach((position, i) => {
                  positions.current.set(`${layoutKey}:${visible[i]?.id}`, position);
                });
              }}
              onKeyDown={() => {
                dragged.current = false;
              }}
              onClick={() => {
                if (!dragged.current) onSelect(group);
              }}
              aria-label={`${group.label}: ${formatMoney(group.netCents / 100)}. ${budgetLabel}.`}
              title={`${group.label}: ${formatMoney(group.netCents / 100)}. ${budgetLabel}.`}
              style={{
                width: diameter,
                height: diameter,
                touchAction: "none",
                backgroundColor: visual.backgroundColor,
              }}
              className="group absolute left-0 top-0 flex flex-col items-center justify-center gap-1 overflow-hidden rounded-full border-0 p-0 text-foreground"
              transition={
                reduced
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 500, damping: 42, mass: 0.9 }
              }
            >
              <span
                className="spending-bubble-material pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-full"
                style={{
                  backgroundColor: `color-mix(in srgb, ${visual.color} 15%, var(--background))`,
                }}
              >
                {fill !== null ? (
                  <motion.span
                    aria-hidden="true"
                    data-budget-fill="true"
                    className="spending-bubble-fill pointer-events-none absolute inset-0 overflow-hidden rounded-full"
                    initial={false}
                    animate={{ clipPath: `inset(${(1 - fill) * 100}% 0 0 0)` }}
                    transition={{ duration: reduced ? 0 : 0.3, ease: "easeOut" }}
                    style={{
                      backgroundColor: `color-mix(in srgb, ${visual.color} 35%, var(--background))`,
                    }}
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-full bg-foreground/0 group-hover:bg-foreground/5 group-focus-visible:bg-foreground/5"
                />
                {diameter >= 18 ? (
                  <span
                    aria-hidden="true"
                    data-spending-icon={visual.icon}
                    className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 shrink-0 [&>svg]:size-full"
                  >
                    <VisualIcon />
                  </span>
                ) : null}
                {diameter >= 92 ? (
                  <span className="absolute top-[calc(50%+0.75rem)] max-w-full px-2 text-center text-xs">
                    <span className="block truncate">{group.label}</span>
                    {formatMoney(group.netCents / 100)}
                    {overage > 0 ? <span className="block">Over budget</span> : null}
                  </span>
                ) : null}
              </span>
            </SpendingBubble>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        Circle size: selected-period spending. Fill: monthly budget used, when available. Negative
        adjustments and zero-spend groups remain in List.
      </p>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="min-h-11 w-full justify-between">
            All spending groups ({visible.length})<ChevronDownIcon />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul aria-label="Spending groups" className="grid gap-1 sm:grid-cols-2">
            {visible.map((group, index) => {
              const visual = spendingGroupVisual(group);
              const VisualIcon = visual.Icon;
              const budget =
                monthlyBudget?.state === "qualified"
                  ? monthlyBudget.groups.find((item) => item.groupId === group.id)
                  : undefined;
              const overage =
                budget?.budgetCents !== null && budget?.budgetCents !== undefined
                  ? Math.max(0, budget.usedCents - budget.budgetCents)
                  : 0;
              return (
                <li key={group.id} className="min-w-0">
                  <Button
                    variant="ghost"
                    className="h-auto min-h-11 w-full justify-start whitespace-normal text-left"
                    aria-label={`Open ${group.label} details`}
                    aria-describedby={`${descriptionId}-${index}`}
                    onClick={() => onSelect(group)}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-7 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: visual.backgroundColor }}
                    >
                      <VisualIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 break-words">{group.label}</span>
                    <span className="shrink-0 text-right tabular-nums">
                      {formatMoney(group.netCents / 100)}
                      {overage > 0 ? (
                        <span className="block text-xs text-muted-foreground">
                          Over budget {formatMoney(overage / 100)}
                        </span>
                      ) : null}
                    </span>
                  </Button>
                  <span id={`${descriptionId}-${index}`} className="sr-only">
                    Selected-period spending {formatMoney(group.netCents / 100)}.{" "}
                    {monthlyBudgetLabel(budget, monthlyBudget)}.
                  </span>
                </li>
              );
            })}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
