import { type FinanceSpendingGroup, financeGroupIcon } from "@personal-os/domain";
import {
  BankIcon,
  CircleHelpIcon,
  DiningIcon,
  DollarIcon,
  EducationIcon,
  EntertainmentIcon,
  GiftIcon,
  GroceryCartIcon,
  HealthIcon,
  HouseIcon,
  LayersIcon,
  MerchantIcon,
  ReceiptIcon,
  SparklesIcon,
  TagsIcon,
  TransportIcon,
  TravelIcon,
  WalletIcon,
} from "@/components/icons";

const palette = ["#6366F1", "#0891B2", "#059669", "#D97706", "#DB2777", "#7C3AED"] as const;
/** A stable identity tint supports older responses and buckets without stored artwork. */
export function spendingGroupVisual(
  group: Pick<FinanceSpendingGroup, "id" | "kind" | "visual"> & { label?: string },
) {
  let hash = 2166136261;
  for (const character of group.id)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const assigned = group.visual?.color;
  const color =
    assigned && /^#[0-9a-fA-F]{6}$/.test(assigned)
      ? assigned
      : (palette[hash % palette.length] ?? palette[0]);
  const stored = group.visual?.icon;
  const icon =
    stored && !["category", "bucket"].includes(stored)
      ? stored
      : financeGroupIcon(
          group.label ?? "",
          group.id === "uncategorized" ? "uncategorized" : (group.kind ?? "category"),
        );
  const icons = {
    category: TagsIcon,
    bucket: LayersIcon,
    uncategorized: CircleHelpIcon,
    home: HouseIcon,
    groceries: GroceryCartIcon,
    dining: DiningIcon,
    transport: TransportIcon,
    travel: TravelIcon,
    education: EducationIcon,
    gifts: GiftIcon,
    health: HealthIcon,
    entertainment: EntertainmentIcon,
    subscriptions: ReceiptIcon,
    shopping: MerchantIcon,
    income: DollarIcon,
    savings: BankIcon,
    debt: WalletIcon,
    lifestyle: SparklesIcon,
  };
  const Icon = icons[icon];
  return { color, icon, Icon, backgroundColor: `${color}26`, fillColor: `${color}3D` };
}
