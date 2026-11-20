// Managing the job-title list (M16), with tenant.settings.manage. Titles are
// archived, never deleted: people and rules that use one keep it.

import type { TenantTx } from "@/lib/tenancy";

import type { Workspace } from "./resolve";

type Ready = Extract<Workspace, { kind: "ready" }>;

export type TitleResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

const canManage = (ws: Ready) =>
  ws.grants.get("tenant.settings.manage") === "all";

export async function listTitles(tx: TenantTx) {
  const rows = await tx.jobTitle.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  // How many current staff use each title (ignoring capitals and spaces).
  const staff = await tx.employee.groupBy({
    by: ["jobTitle"],
    where: { status: { in: ["pending", "active"] }, jobTitle: { not: null } },
    _count: { _all: true },
  });
  const count = new Map<string, number>();
  for (const s of staff) {
    const k = s.jobTitle!.replace(/\s+/g, " ").trim().toLowerCase();
    count.set(k, (count.get(k) ?? 0) + s._count._all);
  }
  const listed = new Set(rows.map((r) => r.name.toLowerCase()));
  return {
    titles: rows.map((r) => ({
      ...r,
      staff: count.get(r.name.toLowerCase()) ?? 0,
    })),
    // Titles staff already have that aren't on the list.
    unlisted: [...count.entries()]
      .filter(([k]) => !listed.has(k))
      .map(([k, n]) => {
        const shown = staff.find(
          (s) => s.jobTitle!.replace(/\s+/g, " ").trim().toLowerCase() === k,
        )!.jobTitle!;
        return { name: shown.replace(/\s+/g, " ").trim(), staff: n };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function addTitles(
  tx: TenantTx,
  ws: Ready,
  raw: string,
): Promise<TitleResult & { added?: number }> {
  if (!canManage(ws))
    return { ok: false, message: "Your role doesn't allow this change." };
  // One title per line, so a whole list can be pasted in. The first spelling
  // of a repeated title wins.
  const firstSpelling = new Map<string, string>();
  for (const n of raw.split(/\r?\n/)) {
    const name = n.replace(/\s+/g, " ").trim();
    if (name && !firstSpelling.has(name.toLowerCase()))
      firstSpelling.set(name.toLowerCase(), name);
  }
  const names = [...firstSpelling.values()];
  if (!names.length)
    return {
      ok: false,
      message: "Enter a job title.",
      fieldErrors: { names: "Enter a job title" },
    };
  const tooLong = names.find((n) => n.length > 100);
  if (tooLong || names.length > 100)
    return {
      ok: false,
      message:
        "Keep each title under 100 characters, and add up to 100 at once.",
      fieldErrors: { names: "Keep each title under 100 characters" },
    };
  const existing = new Set(
    (
      await tx.jobTitle.findMany({
        where: { archivedAt: null },
        select: { name: true },
      })
    ).map((t) => t.name.toLowerCase()),
  );
  const fresh = names.filter((n) => !existing.has(n.toLowerCase()));
  for (const name of fresh) {
    const row = await tx.jobTitle.create({
      data: { tenantId: ws.tenant.id, name, createdBy: ws.ctx.userId! },
      select: { id: true },
    });
    await tx.auditEvent.create({
      data: {
        tenantId: ws.tenant.id,
        actorUserId: ws.ctx.userId!,
        action: "job_title.added",
        targetType: "job_title",
        targetId: row.id,
        detail: {},
      },
      select: { id: true },
    });
  }
  return { ok: true, added: fresh.length };
}

export async function archiveTitle(
  tx: TenantTx,
  ws: Ready,
  id: string,
): Promise<TitleResult> {
  if (!canManage(ws))
    return { ok: false, message: "Your role doesn't allow this change." };
  const row = /^[0-9a-f-]{36}$/i.test(id)
    ? await tx.jobTitle.findUnique({
        where: { tenantId_id: { tenantId: ws.tenant.id, id } },
        select: { id: true, archivedAt: true },
      })
    : null;
  if (!row || row.archivedAt)
    return { ok: false, message: "That job title couldn't be found." };
  await tx.jobTitle.update({
    where: { tenantId_id: { tenantId: ws.tenant.id, id: row.id } },
    data: { archivedAt: new Date(), archivedBy: ws.ctx.userId! },
    select: { id: true },
  });
  await tx.auditEvent.create({
    data: {
      tenantId: ws.tenant.id,
      actorUserId: ws.ctx.userId!,
      action: "job_title.archived",
      targetType: "job_title",
      targetId: row.id,
      detail: {},
    },
    select: { id: true },
  });
  return { ok: true };
}
