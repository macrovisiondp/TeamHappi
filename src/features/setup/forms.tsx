"use client";

import { EMPLOYMENT_STATUSES, TIMEZONES } from "@/lib/validation/organisation";

import {
  changeSiteStatus,
  changeTeamStatus,
  saveEmployee,
  saveOrganisation,
  saveSite,
  saveTeam,
} from "./actions";
import {
  CheckboxGroup,
  SelectField,
  SetupForm,
  StatusChange,
  TextField,
} from "./form";

const timezoneOptions = (current?: string) =>
  [...new Set([...(current ? [current] : []), ...TIMEZONES])].map((tz) => ({
    value: tz,
    label: tz.replace("_", " "),
  }));

export function OrganisationForm({
  name,
  timezone,
}: {
  name: string;
  timezone: string;
}) {
  return (
    <SetupForm action={saveOrganisation} submitLabel="Save organisation">
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            name="name"
            label="Organisation name"
            defaultValue={name}
            error={e.name}
            required
            autoComplete="organization"
          />
          <SelectField
            name="timezone"
            label="Time zone"
            options={timezoneOptions(timezone)}
            defaultValue={timezone}
            error={e.timezone}
            hint="Used for rotas, start dates and reports."
            required
          />
        </div>
      )}
    </SetupForm>
  );
}

export interface SiteValues {
  id?: string;
  name?: string;
  code?: string;
  addressLine?: string | null;
  town?: string | null;
  postcode?: string | null;
  timezone?: string;
}

export function SiteForm({
  site,
  defaultTimezone,
}: {
  site?: SiteValues;
  defaultTimezone: string;
}) {
  const tz = site?.timezone ?? defaultTimezone;
  return (
    <SetupForm
      action={saveSite}
      submitLabel={site?.id ? "Save site" : "Add site"}
      hidden={site?.id ? { id: site.id } : undefined}
    >
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            name="name"
            label="Site name"
            defaultValue={site?.name}
            error={e.name}
            required
          />
          <TextField
            name="code"
            label="Site code"
            defaultValue={site?.code}
            error={e.code}
            hint="A short reference such as QUAY. Leave blank to create one."
          />
          <TextField
            name="addressLine"
            label="Address"
            defaultValue={site?.addressLine}
            error={e.addressLine}
            autoComplete="address-line1"
            className="md:col-span-2"
          />
          <TextField
            name="town"
            label="Town or city"
            defaultValue={site?.town}
            error={e.town}
            autoComplete="address-level2"
          />
          <TextField
            name="postcode"
            label="Postcode"
            defaultValue={site?.postcode}
            error={e.postcode}
            autoComplete="postal-code"
          />
          <SelectField
            name="timezone"
            label="Time zone"
            options={timezoneOptions(tz)}
            defaultValue={tz}
            error={e.timezone}
            required
          />
        </div>
      )}
    </SetupForm>
  );
}

export function SiteStatusChange({
  id,
  name,
  active,
}: {
  id: string;
  name: string;
  active: boolean;
}) {
  return active ? (
    <StatusChange
      action={changeSiteStatus}
      id={id}
      nextStatus="archived"
      label="Deactivate site"
      confirmTitle={`Deactivate ${name}?`}
      confirmText="It will no longer be offered for new teams or people. Existing records and history are kept, and you can reactivate it at any time."
    />
  ) : (
    <StatusChange
      action={changeSiteStatus}
      id={id}
      nextStatus="active"
      label="Reactivate site"
      confirmTitle={`Reactivate ${name}?`}
      confirmText="It will be available again for new teams and people."
    />
  );
}

export function TeamForm({
  team,
  sites,
}: {
  team?: { id: string; name: string; siteId: string };
  sites: readonly { id: string; name: string }[];
}) {
  return (
    <SetupForm
      action={saveTeam}
      submitLabel={team ? "Save team" : "Add team"}
      hidden={team ? { id: team.id } : undefined}
    >
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            name="name"
            label="Team name"
            defaultValue={team?.name}
            error={e.name}
            hint="For example Kitchen, Front of house or Bar."
            required
          />
          <SelectField
            name="siteId"
            label="Site"
            options={sites.map((s) => ({ value: s.id, label: s.name }))}
            defaultValue={
              team?.siteId ?? (sites.length === 1 ? sites[0]!.id : "")
            }
            placeholder="Choose a site"
            error={e.siteId}
            required
          />
        </div>
      )}
    </SetupForm>
  );
}

export function TeamStatusChange({
  id,
  name,
  archived,
}: {
  id: string;
  name: string;
  archived: boolean;
}) {
  return archived ? (
    <StatusChange
      action={changeTeamStatus}
      id={id}
      nextStatus="active"
      label="Reactivate team"
      confirmTitle={`Reactivate ${name}?`}
      confirmText="People can be added to it again."
    />
  ) : (
    <StatusChange
      action={changeTeamStatus}
      id={id}
      nextStatus="archived"
      label="Deactivate team"
      confirmTitle={`Deactivate ${name}?`}
      confirmText="It won't be offered for new assignments. Current members and history are kept."
    />
  );
}

const STATUS_LABELS: Record<(typeof EMPLOYMENT_STATUSES)[number], string> = {
  pending: "Starting soon",
  active: "Active",
  left: "Left",
};

export interface EmployeeValues {
  id: string;
  givenName: string;
  familyName: string;
  preferredName: string | null;
  jobTitle: string | null;
  employeeNumber: string;
  email: string | null;
  phoneNumber: string | null;
  status: (typeof EMPLOYMENT_STATUSES)[number];
  startDate: string | null;
  endDate: string | null;
  primarySiteId: string | null;
  teamIds: string[];
}

export function EmployeeForm({
  employee,
  sites,
  teams,
}: {
  employee?: EmployeeValues;
  sites: readonly { id: string; name: string }[];
  teams: readonly { id: string; name: string; siteId: string }[];
}) {
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? "";
  return (
    <SetupForm
      action={saveEmployee}
      submitLabel={employee ? "Save changes" : "Add person"}
      hidden={employee ? { id: employee.id } : undefined}
    >
      {(e) => (
        <>
          <fieldset className="grid gap-4 md:grid-cols-2">
            <legend className="mb-2 text-lg font-semibold">
              Name and role
            </legend>
            <TextField
              name="givenName"
              label="First name"
              defaultValue={employee?.givenName}
              error={e.givenName}
              required
            />
            <TextField
              name="familyName"
              label="Last name"
              defaultValue={employee?.familyName}
              error={e.familyName}
              required
            />
            <TextField
              name="preferredName"
              label="Preferred name"
              defaultValue={employee?.preferredName}
              error={e.preferredName}
            />
            <TextField
              name="jobTitle"
              label="Job title"
              defaultValue={employee?.jobTitle}
              error={e.jobTitle}
              hint="For example Sous chef or Bartender."
            />
          </fieldset>
          <fieldset className="grid gap-4 md:grid-cols-2">
            <legend className="mb-2 text-lg font-semibold">Employment</legend>
            <SelectField
              name="status"
              label="Status"
              options={EMPLOYMENT_STATUSES.map((s) => ({
                value: s,
                label: STATUS_LABELS[s],
              }))}
              defaultValue={employee?.status ?? "pending"}
              error={e.status}
              required
            />
            <TextField
              name="employeeNumber"
              label="Employee number"
              defaultValue={employee?.employeeNumber}
              error={e.employeeNumber}
              hint={employee ? undefined : "Leave blank to create one."}
            />
            <TextField
              name="startDate"
              label="Start date"
              type="date"
              defaultValue={employee?.startDate}
              error={e.startDate}
            />
            <TextField
              name="endDate"
              label="Leaving date"
              type="date"
              defaultValue={employee?.endDate}
              error={e.endDate}
              hint="Only when the status is Left."
            />
            <SelectField
              name="primarySiteId"
              label="Main site"
              options={sites.map((s) => ({ value: s.id, label: s.name }))}
              defaultValue={
                employee?.primarySiteId ??
                (sites.length === 1 ? sites[0]!.id : "")
              }
              placeholder="Choose a site"
              error={e.primarySiteId}
              required
            />
          </fieldset>
          <CheckboxGroup
            name="teamIds"
            legend="Teams"
            options={teams.map((t) => ({
              value: t.id,
              label: t.name,
              detail: siteName(t.siteId),
            }))}
            defaultValues={employee?.teamIds ?? []}
            error={e.teamIds}
            hint="Teams at the sites you manage."
          />
          <fieldset className="grid gap-4 md:grid-cols-2">
            <legend className="mb-2 text-lg font-semibold">Work contact</legend>
            <TextField
              name="email"
              label="Work email"
              type="email"
              defaultValue={employee?.email}
              error={e.email}
              hint="Used later for invitations. No login is created now."
            />
            <TextField
              name="phoneNumber"
              label="Work phone"
              type="tel"
              defaultValue={employee?.phoneNumber}
              error={e.phoneNumber}
            />
          </fieldset>
        </>
      )}
    </SetupForm>
  );
}
