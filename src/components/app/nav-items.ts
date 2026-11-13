import {
  ArrowLeftRight,
  CalendarDays,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  Receipt,
  Repeat,
  ArrowUpDown,
  ChartColumn,
  LineChart,
  Settings,
  Sparkles,
  Target,
  Users,
  TrendingUp,
  Wallet,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  Icon: typeof Landmark;
  exact?: boolean;
}

/** One list drives the sidebar, the "All sections" page and the route test. */
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "Overview", items: [{ href: "/app", label: "Dashboard", Icon: LayoutDashboard, exact: true }] },
  {
    title: "Manage money",
    items: [
      { href: "/app/transactions", label: "Transactions", Icon: ArrowLeftRight },
      { href: "/app/accounts", label: "Accounts", Icon: Landmark },
      { href: "/app/income", label: "Income", Icon: Wallet },
      { href: "/app/bills", label: "Bills", Icon: Receipt },
      { href: "/app/subscriptions", label: "Subscriptions", Icon: Repeat },
      { href: "/app/debt", label: "Loans and debt", Icon: TrendingUp },
      { href: "/app/import", label: "Import and export", Icon: ArrowUpDown },
    ],
  },
  {
    title: "Plan and save",
    items: [
      { href: "/app/budgets", label: "Budgets", Icon: PiggyBank },
      { href: "/app/goals", label: "Savings goals", Icon: Target },
      { href: "/app/calendar", label: "Calendar", Icon: CalendarDays },
    ],
  },
  {
    title: "Understand",
    items: [
      { href: "/app/analytics", label: "Analytics", Icon: ChartColumn },
      { href: "/app/forecast", label: "Forecast", Icon: LineChart },
      { href: "/app/assistant", label: "Assistant", Icon: Sparkles },
    ],
  },
  {
    title: "Share and manage",
    items: [
      { href: "/app/members", label: "Members", Icon: Users },
      { href: "/app/settings", label: "Settings", Icon: Settings },
    ],
  },
];
