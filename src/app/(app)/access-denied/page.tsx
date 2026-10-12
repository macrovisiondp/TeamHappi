import type { Metadata } from "next";

import { PermissionDenied } from "@/components/states/states";

export const metadata: Metadata = { title: "Access denied" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

// Destination for server-side permission refusals (wired in Milestone 3.3).
export default function AccessDeniedPage() {
  return <PermissionDenied />;
}
