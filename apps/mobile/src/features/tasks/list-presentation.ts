import type { TaskList, TaskListIcon } from "@personal-os/domain";
import type { IconName } from "../../components/icons";

export const listIcons: Record<TaskListIcon, IconName> = {
  list: "views",
  home: "home",
  star: "star",
  target: "target",
  calendar: "calendar",
  wallet: "wallet",
  people: "people",
  receipt: "receipt",
};
const namedColors: Record<string, string> = {
  blue: "#3b82f6",
  purple: "#a78bfa",
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  cyan: "#06b6d4",
  pink: "#ec4899",
};
export function normalizedListColor(color?: string | null) {
  return namedColors[color?.toLowerCase() ?? ""] ?? color ?? "";
}
/** Preserve stored identity; adapt only its small foreground glyph for contrast. */
export function listTint(color: string | null | undefined, dark: boolean, fallback: string) {
  const hex = normalizedListColor(color);
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return fallback;
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const luminance = (rgb: number[]) =>
    rgb.reduce((sum, value, i) => {
      const s = value / 255;
      return (
        sum +
        (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]
      );
    }, 0);
  // Small identity glyphs need at least 3:1 against the grouped surface in either theme.
  const surface = dark ? [39, 39, 43] : [255, 255, 255];
  const bg = luminance(surface);
  for (let step = 0; step < 20; step++) {
    const fg = luminance(channels);
    if ((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) >= 3) break;
    for (let i = 0; i < 3; i++)
      channels[i] = Math.round(channels[i] + ((dark ? 255 : 0) - channels[i]) * 0.15);
  }
  return `#${channels.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
export function listOption(record: TaskList) {
  return {
    value: record.id,
    label: record.name,
    icon: listIcons[record.icon ?? "list"],
    color: record.color ?? undefined,
  };
}
