import {
  CalendarDays,
  ClipboardCheck,
  Clock,
  GraduationCap,
  LayoutDashboard,
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
  /** "demo": synthetic data; "planned": overview only until the module ships. */
  stage: "demo" | "planned";
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    stage: "demo",
  },
  { href: "/people", label: "People", icon: Users, stage: "demo" },
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

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
