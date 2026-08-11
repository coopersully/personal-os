import {
  ActivityIcon,
  BankIcon,
  CalendarIcon,
  CircleCheckIcon,
  ClockIcon,
  CompassIcon,
  DollarIcon,
  HouseIcon,
  type Icon,
  InboxIcon,
  ListChecksIcon,
  ListTodoIcon,
  MailIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SliderHorizontalIcon,
  TargetIcon,
  WalletIcon,
} from "../components/icons.js";
import type { WorkspaceId } from "./manifest.js";

export type MobileWorkspacePage = {
  icon: Icon;
  label: string;
  path: string;
};

const mobileWorkspacePagesByWorkspace: Record<WorkspaceId, MobileWorkspacePage[]> = {
  today: [
    { icon: HouseIcon, label: "Today", path: "/today" },
    { icon: TargetIcon, label: "Goals", path: "/goals" },
    { icon: CompassIcon, label: "Motives", path: "/motives" },
    { icon: ActivityIcon, label: "Activity", path: "/activity" },
  ],
  calendar: [{ icon: CalendarIcon, label: "Calendar", path: "/calendar" }],
  tasks: [
    { icon: InboxIcon, label: "Inbox", path: "/tasks" },
    { icon: ListChecksIcon, label: "Next", path: "/tasks?view=next" },
    { icon: ClockIcon, label: "Scheduled", path: "/tasks?view=scheduled" },
    { icon: CircleCheckIcon, label: "Completed", path: "/tasks?view=completed" },
    { icon: ListTodoIcon, label: "Reminders", path: "/reminders" },
  ],
  mail: [{ icon: MailIcon, label: "Mail", path: "/mail" }],
  finances: [
    { icon: BankIcon, label: "Overview", path: "/finances" },
    { icon: DollarIcon, label: "Cash flow", path: "/finances/cashflow" },
    { icon: ReceiptIcon, label: "Transactions", path: "/finances/transactions" },
    { icon: WalletIcon, label: "Budgets", path: "/finances/budgets" },
    { icon: ReceiptIcon, label: "Subscriptions", path: "/finances/subscriptions" },
    { icon: ShieldCheckIcon, label: "Ledger health", path: "/finances/health" },
    { icon: SliderHorizontalIcon, label: "Financial profile", path: "/finances/profile" },
  ],
};

export function mobileWorkspacePages(workspace: WorkspaceId): MobileWorkspacePage[] {
  return mobileWorkspacePagesByWorkspace[workspace];
}
