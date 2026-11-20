/** Eight edge positions, numbered clockwise from top-left like the desktop pet's anchors. */
export type RitualAnchor = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const storageKey = "nohmi:ritual-card:anchor";
const defaultAnchor: RitualAnchor = 4;
// [column, row] with 0 = leading/top and 2 = trailing/bottom.
const cells: [number, number][] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [0, 1],
];
const anchorAt = (column: number, row: number) =>
  cells.findIndex(([c, r]) => c === column && r === row) as RitualAnchor;

/** Placement is a per-browser convenience; unavailable storage falls back to bottom-right. */
export function readRitualAnchor(): RitualAnchor {
  try {
    const value = Number(localStorage.getItem(storageKey) ?? defaultAnchor);
    return Number.isInteger(value) && value >= 0 && value <= 7
      ? (value as RitualAnchor)
      : defaultAnchor;
  } catch {
    return defaultAnchor;
  }
}
export function saveRitualAnchor(anchor: RitualAnchor) {
  try {
    localStorage.setItem(storageKey, String(anchor));
  } catch {
    // The card still moves for this visit.
  }
}

/** Snap a released card to the anchor nearest its centre; the middle resolves to the closer edge. */
export function nearestRitualAnchor(
  x: number,
  y: number,
  width: number,
  height: number,
): RitualAnchor {
  const third = (value: number, size: number) =>
    Math.max(0, Math.min(2, Math.floor((value / size) * 3)));
  let column = third(x, width);
  let row = third(y, height);
  if (column === 1 && row === 1) {
    const dx = x / width - 0.5;
    const dy = y / height - 0.5;
    if (Math.abs(dx) > Math.abs(dy)) column = dx < 0 ? 0 : 2;
    else row = dy < 0 ? 0 : 2;
  }
  return anchorAt(column, row);
}

/** Arrow keys step between anchors and pass over the empty middle. */
export function moveRitualAnchor(anchor: RitualAnchor, key: string): RitualAnchor {
  const step: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const delta = step[key];
  if (!delta) return anchor;
  let [column, row] = cells[anchor]!;
  column = Math.max(0, Math.min(2, column + delta[0]));
  row = Math.max(0, Math.min(2, row + delta[1]));
  if (column === 1 && row === 1) {
    column = Math.max(0, Math.min(2, column + delta[0]));
    row = Math.max(0, Math.min(2, row + delta[1]));
  }
  return anchorAt(column, row);
}
