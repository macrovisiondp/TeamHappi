import {
  Activity,
  BrainCircuit,
  CalendarDays,
  CreditCard,
  HardDrive,
  KeyRound,
  Mail,
  Plug,
  ClipboardCheck,
  Clock,
  GraduationCap,
  LayoutDashboard,
  ScrollText,
  Settings,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";

export interface NavItem {
  href: Route;
  label: string;
  icon: LucideIcon;
  /** "live": real data; "demo": synthetic data; "planned": overview only. */
  stage: "live" | "demo" | "planned";
  /** Match only this path, not its children. */
  exact?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    stage: "live",
  },
  { href: "/people", label: "People", icon: Users, stage: "live" },
  {
    href: "/recruitment",
    label: "Recruitment",
    icon: UserPlus,
    stage: "planned",
  },
  {
    href: "/onboarding",
    label: "Onboarding",
    icon: ClipboardCheck,
    stage: "planned",
  },
  {
    href: "/training",
    label: "Training",
    icon: GraduationCap,
    stage: "planned",
  },
  { href: "/rota", label: "Rota", icon: CalendarDays, stage: "planned" },
  { href: "/attendance", label: "Attendance", icon: Clock, stage: "planned" },
  { href: "/settings", label: "Settings", icon: Settings, stage: "planned" },
];

/** Macrovision Platform Admin. Separate from any tenant's navigation. */
export const PLATFORM_NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/platform/dashboard",
    label: "Overview",
    icon: Activity,
    stage: "demo",
  },
  {
    href: "/platform/integrations",
    label: "Integrations",
    icon: Plug,
    stage: "demo",
    exact: true,
  },
  {
    href: "/platform/integrations/email",
    label: "Email",
    icon: Mail,
    stage: "demo",
  },
  {
    href: "/platform/integrations/storage",
    label: "Storage",
    icon: HardDrive,
    stage: "demo",
  },
  {
    href: "/platform/integrations/payments",
    label: "Payments",
    icon: CreditCard,
    stage: "demo",
  },
  {
    href: "/platform/integrations/ai",
    label: "AI",
    icon: BrainCircuit,
    stage: "demo",
  },
  {
    href: "/platform/integrations/credentials",
    label: "Credentials",
    icon: KeyRound,
    stage: "demo",
  },
  {
    href: "/platform/integrations/audit",
    label: "Audit log",
    icon: ScrollText,
    stage: "demo",
  },
  {
    href: "/platform/settings",
    label: "Settings",
    icon: Settings,
    stage: "demo",
  },
];

/** The labelled demo workspace: same modules, synthetic Dashboard and People. */
export const DEMO_NAV_ITEMS: readonly NavItem[] = NAV_ITEMS.map((item) =>
  item.href === "/dashboard"
    ? { ...item, href: "/demo/dashboard", stage: "demo" }
    : item.href === "/people"
      ? { ...item, href: "/demo/people", stage: "demo" }
      : item,
);

export type NavSet = "tenant" | "demo" | "platform";

export const NAV_SETS: Record<NavSet, readonly NavItem[]> = {
  tenant: NAV_ITEMS,
  demo: DEMO_NAV_ITEMS,
  platform: PLATFORM_NAV_ITEMS,
};

export function isActive(
  pathname: string,
  href: string,
  exact = false,
): boolean {
  return pathname === href || (!exact && pathname.startsWith(`${href}/`));
}
