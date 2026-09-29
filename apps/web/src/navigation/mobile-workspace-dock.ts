import {
  BankIcon,
  CalendarIcon,
  CircleCheckIcon,
  ClockIcon,
  DollarIcon,
  HouseIcon,
  type Icon,
  InboxIcon,
  ListTodoIcon,
  MailIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  TrashIcon,
  WalletIcon,
  XIcon,
} from "../components/icons.js";
import type { WorkspaceId } from "./manifest.js";

export type MobileWorkspacePage = {
  badge?: string;
  icon: Icon;
  label: string;
  path: string;
};

const mobileWorkspacePagesByWorkspace: Record<WorkspaceId, MobileWorkspacePage[]> = {
  today: [{ icon: HouseIcon, label: "Today", path: "/today" }],
  calendar: [{ icon: CalendarIcon, label: "Calendar", path: "/calendar" }],
  tasks: [
    { icon: InboxIcon, label: "Inbox", path: "/tasks" },
    { icon: CalendarIcon, label: "Today", path: "/tasks?view=today" },
    { icon: ClockIcon, label: "Upcoming", path: "/tasks?view=upcoming" },
    { icon: ClockIcon, label: "Scheduled", path: "/tasks?view=scheduled" },
    { icon: CircleCheckIcon, label: "Completed", path: "/tasks?view=completed" },
    { icon: XIcon, label: "Cancelled", path: "/tasks?view=cancelled" },
    { icon: TrashIcon, label: "Trash", path: "/tasks?view=trash" },
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
  ],
};

export function mobileWorkspacePages(workspace: WorkspaceId): MobileWorkspacePage[] {
  return mobileWorkspacePagesByWorkspace[workspace];
}
