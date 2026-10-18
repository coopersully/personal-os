import type { FinanceSpendingGroup } from "@personal-os/domain";
import { CircleHelpIcon, LayersIcon, TagsIcon } from "@/components/icons";

const palette = ["#6366F1", "#0891B2", "#059669", "#D97706", "#DB2777", "#7C3AED"] as const;
/** A stable identity tint supports older responses and buckets without stored artwork. */
export function spendingGroupVisual(
  group: Pick<FinanceSpendingGroup, "id" | "kind"> & {
    visual?: { color: string | null; icon: "category" | "bucket" | "uncategorized" };
  },
) {
  let hash = 2166136261;
  for (const character of group.id)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const assigned = group.visual?.color;
  const color =
    assigned && /^#[0-9a-fA-F]{6}$/.test(assigned)
      ? assigned
      : (palette[hash % palette.length] ?? palette[0]);
  const icon = group.visual?.icon ?? (group.id === "uncategorized" ? "uncategorized" : group.kind);
  const Icon =
    icon === "bucket" ? LayersIcon : icon === "uncategorized" ? CircleHelpIcon : TagsIcon;
  return { color, icon, Icon, backgroundColor: `${color}26` };
}
