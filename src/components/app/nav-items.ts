import {
  ArrowLeftRight,
  CalendarDays,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  Receipt,
  Repeat,
  Target,
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
];
