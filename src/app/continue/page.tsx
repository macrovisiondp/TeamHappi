import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getCurrentUser } from "@/lib/auth";
import { safeNext } from "@/lib/navigation/next";
import { getPlatformAccess } from "@/lib/platform-access";
import { getWorkspace } from "@/lib/workspace";

export const instant = false;

// Where to land after signing in: the page the person was trying to open,
// otherwise Platform Admin for platform staff who belong to no organisation,
// otherwise their organisation's dashboard. Access is still checked by each
// destination; this only chooses where to go.
export default function ContinuePage({ searchParams }: PageProps<"/continue">) {
  return (
    <Suspense>
      <Continue searchParams={searchParams} />
    </Suspense>
  );
}

async function Continue({
  searchParams,
}: {
  searchParams: PageProps<"/continue">["searchParams"];
}): Promise<null> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const { next } = await searchParams;
  const target = safeNext(typeof next === "string" ? next : null);
  if (target) redirect(target as never);
  const [workspace, platform] = await Promise.all([
    getWorkspace(),
    getPlatformAccess(),
  ]);
  if (platform.kind !== "none" && workspace?.kind === "none")
    redirect("/platform");
  redirect("/dashboard");
}
