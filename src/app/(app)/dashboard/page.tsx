import type { Metadata } from "next";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default function DashboardPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      <Card>
        <CardTitle>Nothing here yet</CardTitle>
        <CardDescription>
          Your dashboard will show the tasks and information for your role once
          sign-in and organisation set-up are available.
        </CardDescription>
      </Card>
    </div>
  );
}
