/** Exact Query objects own read feedback; overlapping refreshes retain independent ownership. */
const heldReads = new WeakMap<object, number>();
export function isReadFeedbackHeld(query: object) {
  return (heldReads.get(query) ?? 0) > 0;
}
export function holdReadFeedback(queries: readonly object[]) {
  const held = new Set(queries);
  for (const query of held) heldReads.set(query, (heldReads.get(query) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const query of held) {
      const count = (heldReads.get(query) ?? 1) - 1;
      if (count > 0) heldReads.set(query, count);
      else heldReads.delete(query);
    }
    held.clear();
  };
}
