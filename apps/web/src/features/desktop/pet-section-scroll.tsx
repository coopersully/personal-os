import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "../../components/icons.js";
import { Button } from "../../components/ui/button.js";
import { ScrollArea } from "../../components/ui/scroll-area.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.js";

// Match the viewport's scroll padding, leaving headings clear of the resize edge.
const inset = 12;
function destinations(viewport: HTMLElement) {
  const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  const top = viewport.getBoundingClientRect().top;
  const anchors = Array.from(
    viewport.querySelectorAll<HTMLElement>("[data-pet-scroll-anchor]"),
    (element) =>
      Math.max(
        0,
        Math.min(max, viewport.scrollTop + element.getBoundingClientRect().top - top - inset),
      ),
  );
  const offsets = [...new Set([0, ...anchors])].sort((a, b) => a - b);
  return {
    previous: offsets.filter((offset) => offset < viewport.scrollTop - 1).at(-1),
    next: offsets.find((offset) => offset > viewport.scrollTop + 1),
  };
}

export function PetSectionScroll({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ previous: false, next: false });
  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-measure section changes even when refreshed children have the same total height.
  useLayoutEffect(() => {
    const viewport = root.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const content = root.current?.querySelector<HTMLElement>("[data-pet-scroll-content]");
    if (!viewport || !content) return;
    const update = () => {
      const last = content
        .querySelectorAll<HTMLElement>("[data-pet-scroll-anchor]")
        .item(content.querySelectorAll("[data-pet-scroll-anchor]").length - 1);
      // Give even a short final section enough runway to align below the top inset.
      const padding = Math.max(48, viewport.clientHeight - (last?.offsetHeight ?? 0) - inset);
      if (content.style.paddingBottom !== `${padding}px`)
        content.style.paddingBottom = `${padding}px`;
      const targets = destinations(viewport);
      const next = { previous: targets.previous !== undefined, next: targets.next !== undefined };
      setAvailable((current) =>
        current.previous === next.previous && current.next === next.next ? current : next,
      );
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(viewport);
    observer?.observe(content);
    return () => {
      viewport.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [children]);
  const move = (direction: "previous" | "next") => {
    const viewport = root.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;
    const top = destinations(viewport)[direction];
    if (top === undefined) return;
    viewport.scrollTo({
      top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  };
  return (
    <div ref={root} className="relative min-h-0 flex-1">
      <ScrollArea className="pet-section-scroll h-full rounded-xl bg-background [&_[data-slot=scroll-area-scrollbar]]:z-30">
        <div data-pet-scroll-content className="flex min-w-0 flex-col gap-3 p-3 pb-12">
          {children}
        </div>
      </ScrollArea>
      <nav
        aria-label="Pet sections"
        data-no-drag="true"
        className="absolute bottom-2 right-3 z-20 flex gap-0.5 rounded-full bg-background/90 p-0.5"
      >
        {(["previous", "next"] as const).map((direction) => (
          <Tooltip key={direction}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="rounded-full"
                aria-label={direction === "previous" ? "Previous section" : "Next section"}
                disabled={!available[direction]}
                onClick={() => move(direction)}
              >
                {direction === "previous" ? <ChevronUpIcon /> : <ChevronDownIcon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {direction === "previous" ? "Previous section" : "Next section"}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>
    </div>
  );
}
