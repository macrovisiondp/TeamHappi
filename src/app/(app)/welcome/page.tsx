import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FirstSteps } from "@/features/onboarding/first-steps";
import { PersonalDetails } from "@/features/personal/details-card";
import { RequestList } from "@/features/signing/request-list";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { firstSteps, personalApi, signingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Your first steps" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

/** M19: a new starter's guided first steps, with confetti at the end. */
export default async function WelcomePage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const steps = await firstSteps(ws);
  if (!steps) redirect("/dashboard");
  const requests = (await signingApi.mine(ws)) ?? [];
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <FirstSteps
        employeeId={steps.employeeId}
        firstName={steps.firstName}
        organisation={ws.tenant.name}
        facts={steps.facts}
        about={
          steps.details ? (
            <PersonalDetails
              employeeId={steps.employeeId}
              view={steps.details}
              sensitiveOn={personalApi.sensitiveOn()}
              self
            />
          ) : null
        }
        documents={
          requests.length ? (
            <RequestList requests={requests} side="employee" />
          ) : null
        }
      />
    </div>
  );
}
