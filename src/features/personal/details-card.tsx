import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { DetailsView } from "@/modules/personal";

import { AboutForm, BankForm, RevealButton } from "./controls";

// The personal-details card (M14.2), on My onboarding (the person themselves)
// and on a person's record (HR: everything; site managers: emergency contact).

export function PersonalDetails({
  employeeId,
  view,
  sensitiveOn,
  self,
}: {
  employeeId: string;
  view: DetailsView;
  sensitiveOn: boolean;
  self: boolean;
}) {
  const e = view.emergency;
  if (view.level === "emergency")
    return (
      <Card aria-labelledby="emergency-heading" className="gap-2">
        <CardTitle id="emergency-heading">Emergency contact</CardTitle>
        {e.name ? (
          <p className="text-sm">
            <span className="font-semibold">{e.name}</span>
            {e.relationship ? ` (${e.relationship})` : ""}
            {e.phone ? ` · ${e.phone}` : ""}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">Not given yet.</p>
        )}
      </Card>
    );
  const values = {
    line1: view.address.line1,
    line2: view.address.line2,
    town: view.address.town,
    postcode: view.address.postcode,
    dateOfBirth: view.dateOfBirth,
    emergencyName: e.name,
    emergencyRelationship: e.relationship,
    emergencyPhone: e.phone,
    niLast4: view.niLast4,
  };
  return (
    <>
      <Card aria-labelledby="about-heading" className="gap-3">
        <CardTitle id="about-heading">
          {self ? "About you" : "Personal details"}
        </CardTitle>
        <CardDescription>
          {self
            ? "For your contract and to pay you correctly. Your manager sees your emergency contact; only HR sees the rest."
            : "Visible to owners, administrators and HR. Site managers see the emergency contact only."}
        </CardDescription>
        {view.niLast4 ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p>
              National Insurance number ending{" "}
              <span className="font-semibold">{view.niLast4}</span>
            </p>
            {sensitiveOn ? (
              <RevealButton employeeId={employeeId} field="ni" label="Reveal" />
            ) : null}
          </div>
        ) : null}
        <AboutForm
          employeeId={employeeId}
          values={values}
          sensitiveOn={sensitiveOn}
        />
      </Card>
      <Card aria-labelledby="bank-heading" className="gap-3">
        <CardTitle id="bank-heading">
          {self ? "Payroll details" : "Bank details"}
        </CardTitle>
        {!sensitiveOn ? (
          <p className="text-sm text-ink-muted">
            Bank details aren&rsquo;t switched on yet.
          </p>
        ) : (
          <>
            <CardDescription>
              {self
                ? "The account your wages are paid into."
                : "Shown masked. Revealing them is recorded."}
            </CardDescription>
            {view.bankLast4 ? (
              <RevealButton
                employeeId={employeeId}
                field="bank"
                label="Reveal bank details"
              />
            ) : null}
            <BankForm employeeId={employeeId} last4={view.bankLast4} />
          </>
        )}
      </Card>
    </>
  );
}
