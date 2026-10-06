import { Link } from "react-router-dom";
import {
  BankIcon,
  DollarIcon,
  GridIcon,
  type Icon,
  LockIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  TargetIcon,
  WalletIcon,
} from "@/components/icons";
import { SidebarItemMeta } from "@/components/sidebar-item-meta";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { financeAccountNeedsAttention, financeProfileNeedsAttention } from "./attention";
import { useFinanceConfiguration } from "./use-finance-configuration.js";

export type FinanceSection =
  | "accounts"
  | "budgets"
  | "cashflow"
  | "health"
  | "imports"
  | "overview"
  | "plan"
  | "wealth"
  | "setup"
  | "decisions"
  | "review"
  | "subscriptions"
  | "transactions";

const navigation: Array<{
  items: Array<{ icon: Icon; id: FinanceSection; label: string }>;
  label: string;
}> = [
  {
    label: "Money",
    items: [
      { icon: GridIcon, id: "overview", label: "Overview" },
      { icon: ReceiptIcon, id: "transactions", label: "Transactions" },
      { icon: BankIcon, id: "accounts", label: "Accounts" },
    ],
  },
  {
    label: "Planning",
    items: [
      { icon: WalletIcon, id: "plan", label: "Budget" },
      { icon: DollarIcon, id: "cashflow", label: "Cash flow" },
      { icon: TargetIcon, id: "wealth", label: "Wealth" },
    ],
  },
  { label: "Manage", items: [{ icon: ShieldCheckIcon, id: "setup", label: "Financial profile" }] },
];

export function financeSectionFromPath(pathname: string): FinanceSection {
  const section = pathname.split("/")[2];
  if (section === "budgets") return "plan";
  if (section === "reviews") return "overview";
  return (
    [
      "decisions",
      "accounts",
      "budgets",
      "cashflow",
      "health",
      "imports",
      "overview",
      "plan",
      "wealth",
      "setup",
      "review",
      "subscriptions",
      "transactions",
    ] as const
  ).some((item) => item === section)
    ? (section as FinanceSection)
    : "overview";
}

function financeNavigationActive(section: FinanceSection, destination: FinanceSection) {
  return (
    section === destination ||
    (destination === "cashflow" && section === "subscriptions") ||
    (destination === "accounts" && (section === "imports" || section === "health"))
  );
}

export function FinanceSidebarNavigation({
  onNavigate,
  reviewCount,
  section,
}: {
  onNavigate: () => void;
  reviewCount: number;
  section: FinanceSection;
}) {
  const configuration = useFinanceConfiguration();
  const accounts =
    configuration.data?.accounts?.state === "loaded"
      ? configuration.data.accounts.value?.accounts
      : undefined;
  const profile = configuration.data?.profile;
  const budget = configuration.data?.budget;
  const budgetNeedsInput = configuration.data?.capabilities.budget.state === "needs_input";
  return navigation.map((group) => (
    <div key={group.label}>
      <SidebarGroup>
        <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <nav aria-label={group.label}>
            <SidebarMenu>
              {group.items.map(({ icon: Icon, id, label }) => {
                const attention =
                  id === "accounts"
                    ? accounts?.some((account) => financeAccountNeedsAttention(account)) ||
                      Boolean(
                        configuration.data?.accounts?.state === "loaded" &&
                          configuration.data.accounts.value?.accountSemantics
                            ?.possibleDuplicateGroups.length,
                      )
                    : id === "setup"
                      ? profile?.state === "loaded" && financeProfileNeedsAttention(profile.value)
                      : id === "plan"
                        ? budget?.state === "loaded" && budget.value?.status === "proposed"
                        : false;
                const count = id === "accounts" ? accounts?.length : undefined;
                return (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      className={
                        attention || count !== undefined ? "sidebar-item-with-meta" : undefined
                      }
                      asChild
                      isActive={financeNavigationActive(section, id)}
                      tooltip={label}
                    >
                      <Link
                        aria-current={financeNavigationActive(section, id) ? "page" : undefined}
                        aria-label={
                          id === "review" && reviewCount > 0 ? `${label} ${reviewCount}` : label
                        }
                        onClick={onNavigate}
                        to={id === "overview" ? "/finances" : `/finances/${id}`}
                      >
                        <Icon
                          aria-hidden="true"
                          weight={financeNavigationActive(section, id) ? "Filled" : "Outline"}
                        />
                        <span>{label}</span>
                        {id === "plan" && budgetNeedsInput ? (
                          <LockIcon
                            aria-label="Prerequisites required"
                            className="ml-auto size-3.5 text-muted-foreground"
                          />
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                    <SidebarItemMeta label={label} attention={Boolean(attention)} count={count} />
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>
    </div>
  ));
}
