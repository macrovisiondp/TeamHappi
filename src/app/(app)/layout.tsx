import { AppShell } from "@/components/layout/app-shell";

// Authentication and tenant resolution are added here in Milestone 3.
// Until then these routes render no tenant data.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
