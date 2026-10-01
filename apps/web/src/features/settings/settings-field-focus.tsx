import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { settingsFieldId, settingsFields } from "./settings-fields.js";

const controlSelector = 'input, select, textarea, button, a[href], [role="slider"], [tabindex]';
const visible = (element: HTMLElement) =>
  !element.closest("[hidden]") && element.getClientRects().length > 0;
const text = (element: Element) =>
  (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\s+/g, " ").trim();

/** Resolve allowlisted field destinations after async data/disclosures mount.
 * Searching never changes a value or submits a form. Reveal entries only select
 * a tab, open a menu/disclosure, or open a feature's existing editor.
 */
export function SettingsFieldFocus() {
  const location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    // Re-resolve even when the same result is selected again.
    const navigationKey = location.key;
    if (!navigationKey) return;
    const field = settingsFields.find(
      (item) =>
        settingsFieldId(item) === params.get("field") && item.section === params.get("section"),
    );
    if (!field) return;
    const revealed = new Set<string>();
    let frame = 0;
    let finished = false;
    const find = () => {
      if (finished) return;
      const tab = [
        ...document.querySelectorAll<HTMLElement>('[role="radio"], input[type="radio"]'),
      ].find(
        (element) =>
          field.reveal?.includes(text(element)) &&
          element.getAttribute("aria-checked") !== "true" &&
          visible(element),
      );
      if (tab && !revealed.has(text(tab))) {
        revealed.add(text(tab));
        tab.click();
        schedule();
        return;
      }
      const focusTarget = (name: string) => {
        const identified = document.getElementById(name);
        const named = [
          ...document.querySelectorAll<HTMLElement>("label, legend, h2, h3, button, [aria-label]"),
        ].find((element) => text(element) === name && visible(element));
        const candidate = identified && visible(identified) ? identified : named;
        if (candidate) {
          const labelControl = candidate instanceof HTMLLabelElement ? candidate.control : null;
          const groupControl = candidate
            .closest('[data-slot="field"], fieldset')
            ?.querySelector<HTMLElement>(controlSelector);
          const target =
            labelControl ??
            (candidate.matches(controlSelector) ? candidate : (groupControl ?? candidate));
          target.scrollIntoView?.({ block: "center", behavior: "auto" });
          if (!target.matches(controlSelector)) target.tabIndex = -1;
          target.focus({ preventScroll: true });
          finished = true;
          observer.disconnect();
          return true;
        }
        return false;
      };
      if (focusTarget(field.target)) return;
      for (const name of field.reveal ?? []) {
        if (revealed.has(name)) continue;
        const trigger = [
          ...document.querySelectorAll<HTMLElement>('button, [role="radio"], [role="menuitem"]'),
        ].find(
          (element) =>
            (text(element) === name || text(element).startsWith(`${name} ·`)) && visible(element),
        );
        if (trigger && !trigger.hasAttribute("disabled")) {
          revealed.add(name);
          trigger.click();
          schedule();
          return;
        }
      }
      if (field.fallbackTarget) focusTarget(field.fallbackTarget);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(find);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "data-state"],
    });
    schedule();
    const timeout = window.setTimeout(() => observer.disconnect(), 15000);
    return () => {
      finished = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [location.key, location.search]);
  return null;
}
