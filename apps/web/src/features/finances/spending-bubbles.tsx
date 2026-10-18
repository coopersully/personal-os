import type {
  FinanceSpendingDashboard,
  FinanceSpendingGroup,
  FinanceSpendingMonthlyBudget,
} from "@personal-os/domain";
import { type HTMLMotionProps, motion, useDragControls, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
type Position = { x: number; y: number; radius: number };
/** Bounded deterministic relaxation; no idle simulation or offscreen animation loop. */
export function settleSpendingBubbles(nodes: Position[]) {
  const next = nodes.map((node) => ({ ...node }));
  for (let iteration = 0; iteration < 160; iteration++) {
    for (const node of next) {
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
          a.x -= ux * amount;
          a.y -= uy * amount;
          b.x += ux * amount;
          b.y += uy * amount;
        }
      }
    for (const node of next) {
      node.x = Math.max(node.radius, Math.min(1 - node.radius, node.x));
      node.y = Math.max(node.radius, Math.min(1 - node.radius, node.y));
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
  const reduced = useReducedMotion();
  const [arrange, setArrange] = useState(false);
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
    <section aria-label="Spending bubbles">
      <div className="flex gap-2">
        <Button
          variant="ghost"
          aria-pressed={arrange}
          disabled={!!reduced}
          onClick={() => setArrange(!arrange)}
        >
          Arrange
        </Button>
        <Button variant="ghost" onClick={() => reset(false)}>
          Reset layout
        </Button>
      </div>
      <div
        ref={container}
        className="relative mx-auto aspect-square w-full max-w-xl overflow-hidden"
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
          const fill = budget?.budgetCents
            ? spendingBudgetFillHeight(budget.usedCents / budget.budgetCents)
            : null;
          const overage = budget?.budgetCents
            ? Math.max(0, budget.usedCents - budget.budgetCents)
            : 0;
          const budgetLabel = budget?.budgetCents
            ? `Monthly budget used ${formatMoney(budget.usedCents / 100)} of ${formatMoney(budget.budgetCents / 100)}${monthlyBudget?.state === "qualified" && monthlyBudget.coverage !== "complete" ? "; observed usage, incomplete history" : ""}${overage > 0 ? `; Over budget ${formatMoney(overage / 100)}` : ""}`
            : budget
              ? "No monthly budget limit"
              : "Monthly budget comparison unavailable";
          return (
            <SpendingBubble
              key={group.id}
              type="button"
              drag={!reduced && arrange}
              dragMomentum={false}
              dragElastic={0.12}
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
              onDragEnd={(_, info) => {
                dragged.current = true;
                const next = nodes.map((value, i) =>
                  i === index
                    ? {
                        ...value,
                        x: value.x + info.offset.x / width,
                        y: value.y + info.offset.y / width,
                      }
                    : value,
                );
                const settled = settleSpendingBubbles(next);
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
                touchAction: arrange ? "none" : "pan-y",
                backgroundColor: visual.backgroundColor,
              }}
              className={`group absolute left-0 top-0 flex flex-col items-center justify-center gap-1 overflow-hidden rounded-full p-0 text-foreground ${overage > 0 ? "border-2 border-(--status-warning-foreground)" : "border border-transparent hover:border-foreground/30 focus-visible:border-foreground/60"}`}
              transition={
                reduced ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0.15 }
              }
            >
              {fill !== null ? (
                <motion.span
                  aria-hidden="true"
                  data-budget-fill="true"
                  className="pointer-events-none absolute inset-0 rounded-full"
                  initial={false}
                  animate={{ clipPath: `inset(${(1 - fill) * 100}% 0 0 0)` }}
                  transition={{ duration: reduced ? 0 : 0.3, ease: "easeOut" }}
                  style={{ backgroundColor: visual.fillColor }}
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
                  className="relative size-4 shrink-0 [&>svg]:size-full"
                >
                  <VisualIcon />
                </span>
              ) : null}
              {diameter >= 92 ? (
                <span className="relative max-w-full px-2 text-center text-xs">
                  <span className="block truncate">{group.label}</span>
                  {formatMoney(group.netCents / 100)}
                  {overage > 0 ? (
                    <span className="block">Over budget {formatMoney(overage / 100)}</span>
                  ) : null}
                </span>
              ) : null}
            </SpendingBubble>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        Circle area shows positive spending. Negative adjustments and zero-spend groups remain
        available in List.
      </p>
    </section>
  );
}
