import { useLayoutEffect, useRef } from "react";

/** One persistent surface moves between destinations without remounting their controls. */
export function NavigationHighlight({ selector }: { selector: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const indicator = ref.current;
    const container = indicator?.parentElement;
    if (!indicator || !container) return;
    let frame = 0;
    let initialized = false;
    const measure = () => {
      const selected = container.querySelector<HTMLElement>(selector);
      indicator.hidden = !selected;
      if (!selected) {
        initialized = false;
        return;
      }
      const bounds = container.getBoundingClientRect();
      const target = selected.getBoundingClientRect();
      indicator.style.width = `${target.width}px`;
      indicator.style.height = `${target.height}px`;
      const style = getComputedStyle(selected);
      indicator.style.color =
        style.getPropertyValue("--context-accent").trim() ||
        style.getPropertyValue("--workspace-icon-accent").trim() ||
        style.color;
      indicator.style.transform = `translate(${target.left - bounds.left + container.scrollLeft}px, ${target.top - bounds.top + container.scrollTop}px)`;
      indicator.dataset.ready = String(initialized);
      initialized = true;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const mutation = new MutationObserver(schedule);
    mutation.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-active", "aria-current", "class"],
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(container);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      mutation.disconnect();
      resize.disconnect();
    };
  }, [selector]);
  return <div ref={ref} aria-hidden="true" className="navigation-highlight" />;
}
