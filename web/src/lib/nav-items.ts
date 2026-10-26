import { LayoutDashboard, ListChecks, Send, BarChart3 } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

// Single source of truth for the app's primary destinations — shared by the
// desktop sidebar and the mobile nav so they can never drift.
export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  chip?: string;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Today", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: ListChecks },
  { href: "/followups", label: "Follow-ups", icon: Send },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function visibleNavItems(followupsEnabled: boolean): NavItem[] {
  return followupsEnabled ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.href !== "/followups");
}

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
