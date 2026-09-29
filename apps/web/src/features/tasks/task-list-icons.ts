import type { TaskListIcon } from "@personal-os/domain";
import {
  CalendarIcon,
  HouseIcon,
  type Icon,
  ListTodoIcon,
  ReceiptIcon,
  StarIcon,
  TargetIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/icons";

export const taskListIconOptions: ReadonlyArray<{
  icon: Icon;
  label: string;
  value: TaskListIcon;
}> = [
  { icon: ListTodoIcon, label: "List", value: "list" },
  { icon: HouseIcon, label: "Home", value: "home" },
  { icon: StarIcon, label: "Star", value: "star" },
  { icon: TargetIcon, label: "Goal", value: "target" },
  { icon: CalendarIcon, label: "Calendar", value: "calendar" },
  { icon: WalletIcon, label: "Money", value: "wallet" },
  { icon: UsersIcon, label: "People", value: "people" },
  { icon: ReceiptIcon, label: "Shopping", value: "receipt" },
];

const taskListIcons = Object.fromEntries(
  taskListIconOptions.map((option) => [option.value, option.icon]),
) as Record<TaskListIcon, Icon>;

export function getTaskListIcon(icon?: TaskListIcon | null): Icon {
  return icon ? (taskListIcons[icon] ?? ListTodoIcon) : ListTodoIcon;
}
