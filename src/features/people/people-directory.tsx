"use client";

import { ChevronRight, Search, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/field";
import { Avatar } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import type { DemoEmployee, DemoSite } from "@/features/demo/fixtures";
import { formatDate } from "@/lib/format";

import {
  DEFAULT_FILTERS,
  filterEmployees,
  fullName,
  STATUS_LABEL,
  STATUS_TONE,
  type DirectoryFilters,
} from "./directory";

export function PeopleDirectory({
  employees,
  sites,
}: {
  employees: readonly DemoEmployee[];
  sites: readonly DemoSite[];
}) {
  const [filters, setFilters] = useState<DirectoryFilters>(DEFAULT_FILTERS);
  const results = useMemo(
    () => filterEmployees(employees, filters),
    [employees, filters],
  );
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? "";
  const set = (patch: Partial<DirectoryFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="flex flex-col gap-4">
      <form
        role="search"
        aria-label="Filter people"
        onSubmit={(e) => e.preventDefault()}
        className="grid gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
      >
        <Field id="people-search" label="Search">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
            />
            <Input
              id="people-search"
              type="search"
              placeholder="Name, role or employee number"
              className="pl-9"
              value={filters.query}
              onChange={(e) => set({ query: e.target.value })}
            />
          </div>
        </Field>
        <Field id="people-site" label="Site">
          <Select
            id="people-site"
            value={filters.siteId}
            onChange={(e) => set({ siteId: e.target.value })}
          >
            <option value="all">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="people-status" label="Status">
          <Select
            id="people-status"
            value={filters.status}
            onChange={(e) =>
              set({ status: e.target.value as DirectoryFilters["status"] })
            }
          >
            <option value="all">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </form>

      <p role="status" aria-live="polite" className="text-sm text-ink-muted">
        Showing {results.length} of {employees.length} people
      </p>

      {results.length === 0 ? (
        <EmptyState icon={Users} title="No one matches these filters">
          Try a different name, or choose “All sites” and “All statuses”.
        </EmptyState>
      ) : (
        <>
          {/* Desktop and tablet: table */}
          <Table
            caption="Staff directory (demo data)"
            className="hidden md:block"
          >
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Site</Th>
                <Th>Status</Th>
                <Th>Start date</Th>
              </tr>
            </thead>
            <tbody>
              {results.map((e) => (
                <tr key={e.id} className="hover:bg-surface-muted/60">
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={fullName(e)} size="sm" />
                      <div>
                        <Link
                          href={`/people/${e.id}`}
                          className="font-semibold underline-offset-4 hover:underline"
                        >
                          {fullName(e)}
                        </Link>
                        <p className="text-xs text-ink-muted">
                          {e.employeeNumber}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {e.role}
                    <p className="text-xs text-ink-muted">{e.team}</p>
                  </Td>
                  <Td>{siteName(e.siteId)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[e.status]}>
                      {STATUS_LABEL[e.status]}
                    </Badge>
                  </Td>
                  <Td>{formatDate(e.startDate)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>

          {/* Phones: cards */}
          <ul className="flex flex-col gap-3 md:hidden">
            {results.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/people/${e.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card"
                >
                  <Avatar name={fullName(e)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{fullName(e)}</p>
                    <p className="truncate text-sm text-ink-muted">
                      {e.role} · {siteName(e.siteId)}
                    </p>
                    <Badge tone={STATUS_TONE[e.status]} className="mt-1.5">
                      {STATUS_LABEL[e.status]}
                    </Badge>
                  </div>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-5 text-ink-muted"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
