import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BadgeDollarSign,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Compass,
  House,
  Inbox,
  Landmark,
  ListChecks,
  ListTodo,
  Mail,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  WalletCards,
} from "lucide-react";
import type { WorkspaceId } from "./manifest.js";

export type MobileWorkspacePage = {
  icon: LucideIcon;
  label: string;
  path: string;
};

const mobileWorkspacePagesByWorkspace: Record<WorkspaceId, MobileWorkspacePage[]> = {
  today: [
    { icon: House, label: "Today", path: "/today" },
    { icon: Target, label: "Goals", path: "/goals" },
    { icon: Compass, label: "Motives", path: "/motives" },
    { icon: Activity, label: "Activity", path: "/activity" },
  ],
  calendar: [{ icon: CalendarDays, label: "Calendar", path: "/calendar" }],
  tasks: [
    { icon: Inbox, label: "Inbox", path: "/tasks" },
    { icon: ListChecks, label: "Next", path: "/tasks?view=next" },
    { icon: Clock3, label: "Scheduled", path: "/tasks?view=scheduled" },
    { icon: CheckCircle2, label: "Completed", path: "/tasks?view=completed" },
    { icon: ListTodo, label: "Reminders", path: "/reminders" },
  ],
  mail: [{ icon: Mail, label: "Mail", path: "/mail" }],
  finances: [
    { icon: Landmark, label: "Overview", path: "/finances" },
    { icon: BadgeDollarSign, label: "Cash flow", path: "/finances/cashflow" },
    { icon: ReceiptText, label: "Transactions", path: "/finances/transactions" },
    { icon: WalletCards, label: "Budgets", path: "/finances/budgets" },
    { icon: ReceiptText, label: "Subscriptions", path: "/finances/subscriptions" },
    { icon: ShieldCheck, label: "Ledger health", path: "/finances/health" },
    { icon: SlidersHorizontal, label: "Financial profile", path: "/finances/profile" },
  ],
};

export function mobileWorkspacePages(workspace: WorkspaceId): MobileWorkspacePage[] {
  return mobileWorkspacePagesByWorkspace[workspace];
}
