import "server-only";

import { cookies } from "next/headers";
import { after } from "next/server";
import { randomUUID } from "node:crypto";

import { appEmailProvider } from "@/integrations/email/runtime";
import { cache } from "react";

import { getCurrentUser, invitedAccounts } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { withTenant, type TenantTx } from "@/lib/tenancy";

import { invitationLink } from "@/lib/invitations/token";
import * as onboarding from "@/modules/onboarding";
import * as training from "@/modules/training";
import * as recruitment from "@/modules/recruitment";
import * as rota from "@/modules/rota";
import * as attendance from "@/modules/attendance";
import * as signing from "@/modules/signing";
import * as personal from "@/modules/personal";
import { blobStore, blobStoreFor } from "@/integrations/storage/blob";

import * as cv from "./cv-documents";
import * as push from "./push";
import { pushKeys, webPushSender } from "./push-sender";
import * as signingFiles from "./signing-files";
import { certificatePdf } from "./training-certificate";
import * as jobTitleAdmin from "./job-titles";
import * as images from "./images";
import * as leavers from "./leaving";
import { liveJobTitles } from "@/lib/job-titles";
import * as offerFiles from "./offer-files";
import { getStarted } from "./get-started";
import * as invites from "./invitations";
import * as members from "./members";
import * as mutations from "./mutations";
import * as queries from "./queries";
import type { InvitationPreview } from "./invitations";
import { submitPublicApplication } from "./public-application";
import { publicVacancy as publicVacancyQuery } from "./public-vacancy";
import { listMemberships, resolveWorkspace, type Workspace } from "./resolve";

type Ready = Extract<Workspace, { kind: "ready" }>;

export {
  can,
  isUsable,
  scopeOf,
  siteIdsFor,
  type Grants,
  type MembershipSummary,
  type Scope,
} from "./policy";
export type { Workspace, WorkspaceUser } from "./resolve";

/** Holds only a PREFERENCE (a tenant id); every request re-validates it. */
export const ORGANISATION_COOKIE = "teamhappi.org";

/**
 * The workspace for this request, or null when signed out. Memoised per
 * request only, so suspensions, revoked memberships and expired sessions take
 * effect on the next request.
 */
export const getWorkspace = cache(async (): Promise<Workspace | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!serverEnv().DATABASE_URL) return { kind: "none", user, blocked: [] };
  const preferred = (await cookies()).get(ORGANISATION_COOKIE)?.value;
  return resolveWorkspace(
    db(),
    { userId: user.userId, name: user.name, email: user.email },
    preferred,
  );
});

/** Runs tenant-scoped queries for a ready workspace (RLS applies). */
export function withWorkspace<T>(
  ws: Extract<Workspace, { kind: "ready" }>,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return withTenant(db(), ws.ctx, fn);
}

/** Usable memberships of the signed-in user (for the switcher action). */
export async function myUsableTenantIds(userId: string): Promise<Set<string>> {
  if (!serverEnv().DATABASE_URL) return new Set();
  const memberships = await listMemberships(db(), userId);
  return new Set(
    memberships
      .filter(
        (m) => m.tenantStatus === "active" && m.membershipStatus === "active",
      )
      .map((m) => m.tenantId),
  );
}

export function organisationCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(serverEnv().APP_URL).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  };
}

/** Dashboard figures within the member's scope. */
export const dashboardData = (ws: Ready) => queries.dashboardData(db(), ws);
/** The owner's "Get started" steps, or null for members who can't manage settings. */
export const getStartedSteps = (ws: Ready) => getStarted(db(), ws);
/** People within the member's employee.view scope, or null without it. */
export const listPeople = (ws: Ready) => queries.listPeople(db(), ws);
/** One person within scope, or null (respond 404). */
export const getPerson = (ws: Ready, employeeId: string) =>
  queries.getPerson(db(), ws, employeeId);
export type { DashboardData, PersonRow, SiteRow, TeamRow } from "./queries";
export type { MutationResult } from "./mutations";

export const organisationSettings = (ws: Ready) =>
  queries.organisationSettings(db(), ws);
export const listSites = (ws: Ready) => queries.listSites(db(), ws);
export const getSite = (ws: Ready, id: string) => queries.getSite(db(), ws, id);
export const listTeams = (ws: Ready) => queries.listTeams(db(), ws);
export const getTeam = (ws: Ready, id: string) => queries.getTeam(db(), ws, id);
export const formOptions = (
  ws: Ready,
  code: "site.manage" | "team.manage" | "employee.manage",
) => queries.formOptions(db(), ws, code);

/** Writes (M4.2). Each checks permissions and site scope itself. */
export const mutate = {
  updateOrganisation: (ws: Ready, raw: unknown) =>
    mutations.updateOrganisation(db(), ws, raw),
  createSite: (ws: Ready, raw: unknown) => mutations.createSite(db(), ws, raw),
  updateSite: (ws: Ready, id: string, raw: unknown) =>
    mutations.updateSite(db(), ws, id, raw),
  setSiteStatus: (ws: Ready, id: string, status: "active" | "archived") =>
    mutations.setSiteStatus(db(), ws, id, status),
  createTeam: (ws: Ready, raw: unknown) => mutations.createTeam(db(), ws, raw),
  updateTeam: (ws: Ready, id: string, raw: unknown) =>
    mutations.updateTeam(db(), ws, id, raw),
  setTeamArchived: (ws: Ready, id: string, archived: boolean) =>
    mutations.setTeamArchived(db(), ws, id, archived),
  createEmployee: (ws: Ready, raw: unknown) =>
    mutations.createEmployee(db(), ws, raw),
  updateEmployee: (ws: Ready, id: string, raw: unknown) =>
    mutations.updateEmployee(db(), ws, id, raw),
};

// --- Members and invitations (M6) ----------------------------------------------

export type {
  AuditRow,
  InvitationRow,
  MemberRow,
  MembersPage,
} from "./members";
export type {
  AcceptOutcome,
  InvitationPreview,
  InvitationState,
} from "./invitations";

export const membersPage = (ws: Ready) => members.membersPage(db(), ws);
export const memberActivity = (ws: Ready) => members.memberActivity(db(), ws);

/** Member and invitation changes. Each checks permissions and rules itself. */
export const manageMembers = {
  invite: (ws: Ready, raw: unknown) => members.createInvitation(db(), ws, raw),
  renewInvitation: (ws: Ready, id: string) =>
    members.renewInvitation(db(), ws, id),
  revokeInvitation: (ws: Ready, id: string) =>
    members.revokeInvitation(db(), ws, id),
  changeRole: (
    ws: Ready,
    membershipId: string,
    raw: { roleId?: unknown; siteId?: unknown },
  ) => members.changeMemberRole(db(), ws, membershipId, raw),
  setStatus: (
    ws: Ready,
    membershipId: string,
    next: "active" | "suspended" | "left",
  ) => members.setMemberStatus(db(), ws, membershipId, next),
};

/** The full link for a token: shown once, never stored. */
export const invitationLinkFor = (token: string) =>
  invitationLink(serverEnv().APP_URL, token);

/**
 * Emails an invitation to join this organisation (ADR-0015). Returns whether it
 * was sent; never throws, and nothing about the message is logged. The link
 * is still shown to the person who invited, as a backup.
 */
export async function emailInvitation(
  ws: Ready,
  to: string,
  token: string,
): Promise<boolean> {
  const provider = appEmailProvider(serverEnv());
  if (!provider) return false;
  const org = ws.tenant.name.replace(/\s+/g, " ").slice(0, 200);
  const inviter = (ws.user.name || "Your manager")
    .replace(/\s+/g, " ")
    .slice(0, 100);
  try {
    await provider.send({
      to,
      subject: `${org} has invited you to TeamHappi`,
      text: `Hello,

${inviter} has invited you to join ${org} on TeamHappi, where you'll see your shifts, sign your documents and complete your training.

Create your login here (this link works once, for 7 days):
${invitationLinkFor(token)}

If you weren't expecting this, you can ignore this email.

TeamHappi`,
      idempotencyKey: `invite-${randomUUID()}`,
    });
    return true;
  } catch {
    return false;
  }
}

/** The public invite page (signed in or not). */
export const invitations = {
  preview: async (token: string): Promise<InvitationPreview> =>
    serverEnv().DATABASE_URL
      ? invites.previewInvitation(db(), token)
      : {
          state: "invalid",
          email: null,
          organisation: null,
          role: null,
          site: null,
        },
  /** Joins the SIGNED-IN user. */
  async acceptAsCurrentUser(token: string) {
    const user = await getCurrentUser();
    if (!user) return { outcome: "invalid" as const, tenantId: null };
    return invites.acceptInvitation(db(), user.userId, token);
  },
  /**
   * New people: create the account for the invited address (the link counts
   * as confirming it; see docs/architecture/m6-invitations-members.md), then
   * join. Refused if the person is signed in or the address already has an
   * account (they sign in instead, so a link can never take over an account).
   */
  async createAccountAndJoin(
    token: string,
    raw: { name: unknown; password: unknown },
  ): Promise<
    | { ok: true; email: string }
    | { ok: false; message: string; fieldErrors?: Record<string, string> }
  > {
    if (await getCurrentUser())
      return {
        ok: false,
        message: "Sign out first, or accept as the signed-in account.",
      };
    const preview = await invitations.preview(token);
    if (preview.state !== "valid" || !preview.email)
      return {
        ok: false,
        message: "This invitation link isn't valid any more.",
      };
    const created = await invitedAccounts.create(preview.email, raw);
    if (!created)
      return { ok: false, message: "Accounts can't be created right now." };
    if (!created.ok)
      return created.reason === "exists"
        ? {
            ok: false,
            message:
              "This address already has a TeamHappi account. Sign in to accept.",
          }
        : {
            ok: false,
            message: "Check the highlighted fields.",
            fieldErrors: created.fieldErrors,
          };
    const joined = await invites.acceptInvitation(db(), created.userId, token);
    if (joined.outcome !== "joined" && joined.outcome !== "already_member")
      return {
        ok: false,
        message:
          "Your account was created, but the invitation couldn't be accepted. Ask for a new link.",
      };
    return { ok: true, email: preview.email };
  },
};

// --- Onboarding (M7.1) ----------------------------------------------------------

export type {
  CaseSummary as OnboardingCaseSummary,
  Dashboard as OnboardingDashboard,
  TemplateSummary as OnboardingTemplateSummary,
} from "@/modules/onboarding";

/** The member acting, from the server session (never from the browser). */
const actorOf = (ws: Ready): onboarding.Actor => ({
  tenantId: ws.tenant.id,
  userId: ws.ctx.userId!,
  membershipId: ws.membershipId,
  grants: ws.grants,
});
const todayFor = (ws: Ready) => onboarding.todayIn(ws.tenant.timezone);
const inWs = <T>(
  ws: Ready,
  fn: (tx: TenantTx, a: onboarding.Actor) => Promise<T>,
) => withWorkspace(ws, (tx) => fn(tx, actorOf(ws)));

export const onboardingApi = {
  dashboard: (ws: Ready, filter: { status?: string; siteId?: string }) =>
    inWs(ws, (tx, a) => onboarding.dashboard(tx, a, todayFor(ws), filter)),
  getCase: (ws: Ready, id: string) =>
    inWs(ws, (tx, a) => onboarding.getCase(tx, a, id, todayFor(ws))),
  caseForEmployee: (ws: Ready, employeeId: string) =>
    inWs(ws, (tx, a) =>
      onboarding.caseForEmployee(tx, a, employeeId, todayFor(ws)),
    ),
  startOptions: (ws: Ready) => inWs(ws, onboarding.startOptions),
  listTemplates: (ws: Ready, includeArchived = false) =>
    inWs(ws, (tx, a) => onboarding.listTemplates(tx, a, { includeArchived })),
  getTemplate: (ws: Ready, id: string) =>
    inWs(ws, (tx, a) => onboarding.getTemplate(tx, a, id)),
  startCase: (ws: Ready, raw: Parameters<typeof onboarding.startCase>[2]) =>
    inWs(ws, (tx, a) => onboarding.startCase(tx, a, raw)),
  updateTask: (
    ws: Ready,
    caseId: string,
    taskId: string,
    cmd: onboarding.TaskCommand,
  ) => inWs(ws, (tx, a) => onboarding.updateTask(tx, a, caseId, taskId, cmd)),
  signOff: (ws: Ready, caseId: string, note: unknown) =>
    inWs(ws, (tx, a) =>
      onboarding.signOffCase(tx, a, caseId, todayFor(ws), note),
    ),
  cancel: (ws: Ready, caseId: string, reason: unknown) =>
    inWs(ws, (tx, a) => onboarding.cancelCase(tx, a, caseId, reason)),
  changeOwner: (ws: Ready, caseId: string, membershipId: unknown) =>
    inWs(ws, (tx, a) =>
      onboarding.changeCaseOwner(tx, a, caseId, membershipId),
    ),
  saveTemplate: (ws: Ready, id: string | null, raw: unknown) =>
    inWs(ws, (tx, a) => onboarding.saveTemplate(tx, a, id, raw)),
  archiveTemplate: (ws: Ready, id: string) =>
    inWs(ws, (tx, a) => onboarding.archiveTemplate(tx, a, id)),
  saveTemplateTask: (
    ws: Ready,
    templateId: string,
    taskId: string | null,
    raw: unknown,
  ) =>
    inWs(ws, (tx, a) =>
      onboarding.saveTemplateTask(tx, a, templateId, taskId, raw),
    ),
  archiveTemplateTask: (ws: Ready, templateId: string, taskId: string) =>
    inWs(ws, (tx, a) =>
      onboarding.archiveTemplateTask(tx, a, templateId, taskId),
    ),
  addSuggested: (ws: Ready) => inWs(ws, onboarding.addSuggestedTemplates),
  // M7.2: document checklist and right to work.
  addDocument: (
    ws: Ready,
    caseId: string,
    raw: Parameters<typeof onboarding.addDocument>[3],
  ) => inWs(ws, (tx, a) => onboarding.addDocument(tx, a, caseId, raw)),
  updateDocument: (
    ws: Ready,
    caseId: string,
    documentId: string,
    cmd: onboarding.DocumentCommand,
  ) =>
    inWs(ws, (tx, a) =>
      onboarding.updateDocument(tx, a, caseId, documentId, cmd),
    ),
  /** Restricted: every call is audited as a view of the record. */
  rightToWork: (ws: Ready, employeeId: string) =>
    inWs(ws, (tx, a) =>
      onboarding.getRightToWork(tx, a, employeeId, todayFor(ws)),
    ),
  recordRtw: (ws: Ready, employeeId: string, raw: onboarding.RtwCommand) =>
    inWs(ws, (tx, a) =>
      onboarding.recordRtwCheck(tx, a, employeeId, todayFor(ws), raw),
    ),
  /** Restricted: every call is audited. */
  rtwFollowUps: (ws: Ready) =>
    inWs(ws, (tx, a) => onboarding.rtwFollowUps(tx, a, todayFor(ws))),
  // M7.3: the signed-in member's own onboarding (by ownership, not role).
  mine: (ws: Ready) =>
    inWs(ws, (tx, a) => onboarding.myOnboarding(tx, a, todayFor(ws))),
  completeMine: (ws: Ready, taskId: string, raw: { acknowledge?: unknown }) =>
    inWs(ws, (tx, a) => onboarding.completeMyTask(tx, a, taskId, raw)),
  rtwAttentionCount: (ws: Ready) =>
    inWs(ws, (tx, a) => onboarding.rtwAttentionCount(tx, a, todayFor(ws))),
};

// --- Leaving (M18) ---------------------------------------------------------------

export { LEAVING_REASONS, type LeavingReason } from "./leaving";

export const leavingApi = {
  get: (ws: Ready, employeeId: string) =>
    withWorkspace(ws, (tx) => leavers.leavingFor(tx, ws, employeeId)),
  mark: (
    ws: Ready,
    employeeId: string,
    raw: Parameters<typeof leavers.markLeaving>[3],
  ) =>
    withWorkspace(ws, (tx) =>
      leavers.markLeaving(tx, ws, employeeId, raw, todayFor(ws)),
    ),
  cancel: (ws: Ready, employeeId: string) =>
    withWorkspace(ws, (tx) => leavers.cancelLeaving(tx, ws, employeeId)),
  endNow: (ws: Ready, employeeId: string) =>
    withWorkspace(ws, (tx) =>
      leavers.endAccessNow(tx, ws, employeeId, todayFor(ws)),
    ),
};

// --- Photos and logos (M17) -----------------------------------------------------

export const imagesApi = {
  setPhoto: (ws: Ready, employeeId: string, bytes: Uint8Array) =>
    withWorkspace(ws, (tx) => images.setPhoto(tx, ws, employeeId, bytes)),
  removePhoto: (ws: Ready, employeeId: string) =>
    withWorkspace(ws, (tx) => images.removePhoto(tx, ws, employeeId)),
  setLogo: (ws: Ready, bytes: Uint8Array) =>
    withWorkspace(ws, (tx) => images.setLogo(tx, ws, bytes)),
  removeLogo: (ws: Ready) =>
    withWorkspace(ws, (tx) => images.removeLogo(tx, ws)),
  read: (
    ws: Ready,
    what: { kind: "photo"; employeeId: string } | { kind: "logo" },
  ) => withWorkspace(ws, (tx) => images.readImage(tx, ws, what)),
  photoIds: (ws: Ready, employeeIds: string[]) =>
    withWorkspace(ws, (tx) => images.photoIds(tx, ws, employeeIds)),
  logoId: (ws: Ready) => withWorkspace(ws, (tx) => images.logoId(tx, ws)),
};

/** The signed-in member's own staff record here, with their photo (M17). */
export const myProfile = (ws: Ready) =>
  withWorkspace(ws, async (tx) => {
    const e = await tx.employee.findUnique({
      where: {
        tenantId_membershipId: {
          tenantId: ws.tenant.id,
          membershipId: ws.membershipId,
        },
      },
      select: {
        id: true,
        givenName: true,
        familyName: true,
        preferredName: true,
        jobTitle: true,
        status: true,
        primarySite: { select: { name: true } },
      },
    });
    if (!e) return null;
    const photoId = (await images.photoIds(tx, ws, [e.id])).get(e.id) ?? null;
    return { ...e, siteName: e.primarySite?.name ?? null, photoId };
  });

// --- Job titles (M16) -----------------------------------------------------------

export const jobTitlesApi = {
  /** Live titles for pickers (empty: the organisation types titles freely). */
  options: (ws: Ready) => withWorkspace(ws, liveJobTitles),
  list: (ws: Ready) => withWorkspace(ws, jobTitleAdmin.listTitles),
  add: (ws: Ready, names: string) =>
    withWorkspace(ws, (tx) => jobTitleAdmin.addTitles(tx, ws, names)),
  archive: (ws: Ready, id: string) =>
    withWorkspace(ws, (tx) => jobTitleAdmin.archiveTitle(tx, ws, id)),
};

// --- Training (M8.1) ------------------------------------------------------------

export type {
  CourseSummary as TrainingCourseSummary,
  Matrix as TrainingMatrix,
} from "@/modules/training";

const inTraining = <T>(
  ws: Ready,
  fn: (tx: TenantTx, a: training.Actor) => Promise<T>,
) => withWorkspace(ws, (tx) => fn(tx, actorOf(ws)));
const trainingToday = (ws: Ready) => training.todayIn(ws.tenant.timezone);

export const trainingApi = {
  matrix: (
    ws: Ready,
    filter: {
      siteId?: string;
      teamId?: string;
      jobTitle?: string;
      status?: string;
    },
  ) =>
    inTraining(ws, (tx, a) =>
      training.matrix(tx, a, trainingToday(ws), filter),
    ),
  listCourses: (ws: Ready, includeArchived = false) =>
    inTraining(ws, (tx, a) => training.listCourses(tx, a, { includeArchived })),
  getCourse: (ws: Ready, id: string) =>
    inTraining(ws, (tx, a) => training.getCourse(tx, a, id)),
  saveCourse: (ws: Ready, id: string | null, raw: unknown) =>
    inTraining(ws, (tx, a) => training.saveCourse(tx, a, id, raw)),
  archiveCourse: (ws: Ready, id: string) =>
    inTraining(ws, (tx, a) => training.archiveCourse(tx, a, id)),
  addSuggested: (ws: Ready) => inTraining(ws, training.addSuggestedCourses),
  saveRule: (
    ws: Ready,
    courseId: string,
    ruleId: string | null,
    raw: unknown,
  ) =>
    inTraining(ws, (tx, a) => training.saveRule(tx, a, courseId, ruleId, raw)),
  archiveRule: (ws: Ready, courseId: string, ruleId: string) =>
    inTraining(ws, (tx, a) => training.archiveRule(tx, a, courseId, ruleId)),
  person: (ws: Ready, employeeId: string) =>
    inTraining(ws, (tx, a) =>
      training.personTraining(tx, a, employeeId, trainingToday(ws)),
    ),
  record: (ws: Ready, employeeId: string, raw: training.RecordCommand) =>
    inTraining(ws, (tx, a) =>
      training.recordTraining(tx, a, employeeId, trainingToday(ws), raw),
    ),
  // M8.2: the signed-in member's own training (by ownership, not role).
  mine: (ws: Ready) =>
    inTraining(ws, (tx, a) => training.myTraining(tx, a, trainingToday(ws))),
  confirmMine: (
    ws: Ready,
    courseId: string,
    raw: { acknowledge?: unknown; version?: unknown },
  ) =>
    inTraining(ws, (tx, a) =>
      training.confirmMyCourse(tx, a, courseId, trainingToday(ws), raw),
    ),
  voidRecord: (
    ws: Ready,
    employeeId: string,
    recordId: string,
    reason: unknown,
  ) =>
    inTraining(ws, (tx, a) =>
      training.voidRecord(tx, a, employeeId, recordId, reason),
    ),
  // M15: interactive courses.
  importCourses: (ws: Ready, files: training.ImportFile[], addRules: boolean) =>
    inTraining(ws, (tx, a) => training.importCourses(tx, a, files, addRules)),
  packageSummary: (ws: Ready, courseId: string) =>
    inTraining(ws, (tx, a) => training.coursePackageSummary(tx, a, courseId)),
  awaitingSignOff: (ws: Ready, courseId: string) =>
    inTraining(ws, (tx, a) => training.awaitingSignOff(tx, a, courseId)),
  signOff: (ws: Ready, courseId: string, employeeId: unknown) =>
    inTraining(ws, (tx, a) =>
      training.signOffPractical(tx, a, courseId, employeeId, trainingToday(ws)),
    ),
  learn: (ws: Ready, courseId: string) =>
    inTraining(ws, (tx, a) =>
      training.learnerCourse(tx, a, courseId, trainingToday(ws)),
    ),
  submitModule: (
    ws: Ready,
    courseId: string,
    moduleIndex: unknown,
    answers: unknown,
  ) =>
    inTraining(ws, (tx, a) =>
      training.submitModuleQuiz(tx, a, courseId, moduleIndex, answers),
    ),
  startFinal: (ws: Ready, courseId: string) =>
    inTraining(ws, (tx, a) =>
      training.startFinal(tx, a, courseId, trainingToday(ws)),
    ),
  submitFinal: (
    ws: Ready,
    courseId: string,
    attemptId: unknown,
    answers: unknown,
  ) =>
    inTraining(ws, (tx, a) =>
      training.submitFinal(
        tx,
        a,
        courseId,
        attemptId,
        answers,
        trainingToday(ws),
      ),
    ),
  /** A course certificate PDF (audited), or null if not theirs to see. */
  certificate: async (ws: Ready, recordId: string) => {
    const facts = await inTraining(ws, (tx, a) =>
      training.certificateFacts(tx, a, recordId),
    );
    if (!facts) return null;
    return {
      fileName: `${facts.certificateNo}.pdf`,
      bytes: await certificatePdf(facts, ws.tenant.name),
    };
  },
};

// --- Recruitment (M9.1) ---------------------------------------------------------

/**
 * Runs a recruitment call in one transaction. A Rollback thrown inside undoes
 * everything (for example a hire whose onboarding couldn't start) and becomes
 * the result.
 */
async function inRecruitment<T>(
  ws: Ready,
  fn: (tx: TenantTx, a: recruitment.Actor) => Promise<T>,
): Promise<T | recruitment.Result<never>> {
  try {
    return await withWorkspace(ws, (tx) => fn(tx, actorOf(ws)));
  } catch (e) {
    if (e instanceof recruitment.Rollback) return e.result;
    throw e;
  }
}
const recruitmentToday = (ws: Ready) => recruitment.todayIn(ws.tenant.timezone);

export const recruitmentApi = {
  settings: (ws: Ready) => inRecruitment(ws, recruitment.getSettings),
  saveSettings: (ws: Ready, raw: unknown) =>
    inRecruitment(ws, (tx, a) => recruitment.saveSettings(tx, a, raw)),
  vacancies: (ws: Ready, filter: { status?: string; siteId?: string }) =>
    inRecruitment(ws, (tx, a) => recruitment.listVacancies(tx, a, filter)),
  vacancy: (ws: Ready, id: string) =>
    inRecruitment(ws, (tx, a) => recruitment.getVacancy(tx, a, id)),
  vacancyOptions: (ws: Ready) => inRecruitment(ws, recruitment.vacancyOptions),
  saveVacancy: (ws: Ready, id: string | null, raw: unknown) =>
    inRecruitment(ws, (tx, a) => recruitment.saveVacancy(tx, a, id, raw)),
  setVacancyStatus: (ws: Ready, id: string, status: unknown) =>
    inRecruitment(ws, (tx, a) =>
      recruitment.setVacancyStatus(tx, a, id, status),
    ),
  possibleMatches: (ws: Ready, email: unknown) =>
    inRecruitment(ws, (tx, a) => recruitment.possibleMatches(tx, a, email)),
  addApplication: (
    ws: Ready,
    vacancyId: string,
    raw: Parameters<typeof recruitment.addApplication>[3],
  ) =>
    inRecruitment(ws, (tx, a) =>
      recruitment.addApplication(tx, a, vacancyId, raw),
    ),
  application: (ws: Ready, id: string) =>
    inRecruitment(ws, (tx, a) =>
      recruitment.getApplication(tx, a, id, ws.tenant.timezone),
    ),
  moveStage: (ws: Ready, id: string, to: unknown) =>
    inRecruitment(ws, (tx, a) => recruitment.moveStage(tx, a, id, to)),
  close: (
    ws: Ready,
    id: string,
    cmd: Parameters<typeof recruitment.closeApplication>[3],
  ) =>
    inRecruitment(ws, (tx, a) => recruitment.closeApplication(tx, a, id, cmd)),
  addNote: (ws: Ready, id: string, body: unknown) =>
    inRecruitment(ws, (tx, a) => recruitment.addNote(tx, a, id, body)),
  scheduleInterview: (
    ws: Ready,
    applicationId: string,
    raw: Parameters<typeof recruitment.scheduleInterview>[4],
  ) =>
    inRecruitment(ws, (tx, a) =>
      recruitment.scheduleInterview(
        tx,
        a,
        applicationId,
        ws.tenant.timezone,
        raw,
      ),
    ),
  updateInterview: (ws: Ready, id: string, cmd: recruitment.InterviewCommand) =>
    inRecruitment(ws, (tx, a) =>
      recruitment.updateInterview(tx, a, id, ws.tenant.timezone, cmd),
    ),
  schedule: (ws: Ready, window?: { from: Date; to: Date }) =>
    inRecruitment(ws, (tx, a) => recruitment.interviewSchedule(tx, a, window)),
  /** Hire: one employee per application, even when retried (see recruitment.hire). */
  hire: async (
    ws: Ready,
    applicationId: string,
    raw: Parameters<typeof recruitment.hire>[3],
  ) => {
    const r = await inRecruitment(ws, (tx, a) =>
      recruitment.hire(tx, a, applicationId, raw),
    );
    // Someone else hired it first: everything here was rolled back; return theirs.
    if (!r.ok && r.message === "ALREADY_HIRED")
      return inRecruitment(ws, (tx, a) =>
        recruitment.hire(tx, a, applicationId, raw),
      );
    return r;
  },
  hiredFrom: (ws: Ready, employeeId: string) =>
    inRecruitment(ws, (tx, a) => recruitment.hiredFrom(tx, a, employeeId)),
  retention: (ws: Ready) =>
    inRecruitment(ws, (tx, a) =>
      recruitment.retentionReview(tx, a, recruitmentToday(ws)),
    ),
  anonymise: async (ws: Ready, candidateId: string) => {
    const r = await inRecruitment(ws, (tx, a) =>
      recruitment.anonymiseCandidate(tx, a, candidateId, recruitmentToday(ws)),
    );
    // Their CVs were marked for deletion in that transaction; delete the files now.
    if (r.ok) await cv.purgeDeletedCvs(ws);
    return r;
  },
};

// --- Rota (M10.1) ------------------------------------------------------------------------

const inRota = <T>(
  ws: Ready,
  fn: (tx: TenantTx, a: rota.Actor) => Promise<T>,
) => withWorkspace(ws, (tx) => fn(tx, actorOf(ws)));

/**
 * Runs a rota change; if it succeeded, alerts (after the response is sent)
 * everyone whose published shifts it changed (M12). A few seconds' margin
 * allows for clock differences between the app and the database.
 */
const inRotaNotify = async <T extends { ok: boolean }>(
  ws: Ready,
  fn: (tx: TenantTx, a: rota.Actor) => Promise<T>,
): Promise<T> => {
  const since = new Date(Date.now() - 5_000);
  const r = await inRota(ws, fn);
  const keys = pushKeys();
  if (r.ok && keys)
    after(async () => {
      try {
        await push.notifyShiftChanges(db(), ws, since, webPushSender(keys));
      } catch {
        // Alerts are best-effort; the change itself has already been saved.
      }
    });
  return r;
};

export const rotaApi = {
  sites: (ws: Ready) => inRota(ws, rota.rotaSites),
  week: (ws: Ready, siteId: unknown, weekStart: unknown) =>
    inRota(ws, (tx, a) => rota.getWeek(tx, a, siteId, weekStart)),
  saveShift: (
    ws: Ready,
    siteId: unknown,
    weekStart: unknown,
    shiftId: string | null,
    raw: rota.ShiftInput,
  ) =>
    inRotaNotify(ws, (tx, a) =>
      rota.saveShift(tx, a, siteId, weekStart, shiftId, raw),
    ),
  cancelShift: (ws: Ready, shiftId: unknown) =>
    inRotaNotify(ws, (tx, a) => rota.cancelShift(tx, a, shiftId)),
  assign: (
    ws: Ready,
    shiftId: unknown,
    employeeId: unknown,
    overrideReason: unknown,
  ) =>
    inRotaNotify(ws, (tx, a) =>
      rota.assignShift(tx, a, shiftId, employeeId, overrideReason),
    ),
  unassign: (ws: Ready, shiftId: unknown) =>
    inRotaNotify(ws, (tx, a) => rota.unassignShift(tx, a, shiftId)),
  copyPreviousWeek: (ws: Ready, siteId: unknown, weekStart: unknown) =>
    inRota(ws, (tx, a) => rota.copyPreviousWeek(tx, a, siteId, weekStart)),
  publish: (ws: Ready, siteId: unknown, weekStart: unknown) =>
    inRotaNotify(ws, (tx, a) => rota.publishWeek(tx, a, siteId, weekStart)),
  decideRequest: (
    ws: Ready,
    requestId: unknown,
    decision: unknown,
    overrideReason: unknown,
  ) =>
    inRotaNotify(ws, (tx, a) =>
      rota.decideRequest(tx, a, requestId, decision, overrideReason),
    ),
  // My shifts (M10.2): the signed-in person's own record only.
  mine: (ws: Ready) => inRota(ws, (tx, a) => rota.myShifts(tx, a)),
  myUpdates: (ws: Ready) => inRota(ws, rota.myShiftUpdates),
  markSeen: (ws: Ready) => inRota(ws, rota.markShiftsSeen),
  requestShift: (ws: Ready, shiftId: unknown) =>
    inRota(ws, (tx, a) => rota.requestShift(tx, a, shiftId)),
  withdrawRequest: (ws: Ready, requestId: unknown) =>
    inRota(ws, (tx, a) => rota.withdrawRequest(tx, a, requestId)),
  // M10.3: availability, drops and swaps.
  decideChange: (
    ws: Ready,
    requestId: unknown,
    decision: unknown,
    overrideReason: unknown,
  ) =>
    inRotaNotify(ws, (tx, a) =>
      rota.decideChange(tx, a, requestId, decision, overrideReason),
    ),
  addUnavailability: (ws: Ready, raw: rota.UnavailabilityInput) =>
    inRota(ws, (tx, a) => rota.addUnavailability(tx, a, raw)),
  removeUnavailability: (ws: Ready, id: unknown) =>
    inRota(ws, (tx, a) => rota.removeUnavailability(tx, a, id)),
  requestChange: (
    ws: Ready,
    shiftId: unknown,
    kind: unknown,
    targetEmployeeId: unknown,
  ) =>
    inRota(ws, (tx, a) =>
      rota.requestChange(tx, a, shiftId, kind, targetEmployeeId),
    ),
  withdrawChange: (ws: Ready, requestId: unknown) =>
    inRota(ws, (tx, a) => rota.withdrawChange(tx, a, requestId)),
  respondToSwap: (ws: Ready, requestId: unknown, accept: boolean) =>
    inRota(ws, (tx, a) => rota.respondToSwap(tx, a, requestId, accept)),
};

// --- Attendance (M11.1) ------------------------------------------------------------------

export const attendanceApi = {
  sites: (ws: Ready) => inRota(ws, attendance.attendanceSites),
  whosIn: (ws: Ready, siteId: unknown, day: unknown) =>
    inRota(ws, (tx, a) => attendance.whosIn(tx, a, siteId, day)),
  record: (
    ws: Ready,
    siteId: unknown,
    employeeId: unknown,
    raw: attendance.TimesInput,
  ) =>
    inRota(ws, (tx, a) =>
      attendance.recordEntry(tx, a, siteId, employeeId, raw),
    ),
  correct: (ws: Ready, entryId: unknown, raw: attendance.TimesInput) =>
    inRota(ws, (tx, a) => attendance.correctEntry(tx, a, entryId, raw)),
  remove: (ws: Ready, entryId: unknown, reason: unknown) =>
    inRota(ws, (tx, a) => attendance.removeEntry(tx, a, entryId, reason)),
  saveSettings: (
    ws: Ready,
    raw: { toleranceMinutes?: unknown; missedClockOutHours?: unknown },
  ) => inRota(ws, (tx, a) => attendance.saveSettings(tx, a, raw)),
  mine: (ws: Ready) => inRota(ws, (tx, a) => attendance.myClock(tx, a)),
  clockIn: (ws: Ready) => inRota(ws, (tx, a) => attendance.clockIn(tx, a)),
  clockOut: (ws: Ready) => inRota(ws, (tx, a) => attendance.clockOut(tx, a)),
  toggleBreak: (ws: Ready, start: boolean) =>
    inRota(ws, (tx, a) => attendance.toggleBreak(tx, a, start)),
  timesheet: (ws: Ready, siteId: unknown, week: unknown) =>
    inRota(ws, (tx, a) => attendance.timesheet(tx, a, siteId, week)),
  approve: (ws: Ready, siteId: unknown, week: unknown) =>
    inRota(ws, (tx, a) => attendance.approveTimesheet(tx, a, siteId, week)),
  reopen: (ws: Ready, siteId: unknown, week: unknown, reason: unknown) =>
    inRota(ws, (tx, a) =>
      attendance.reopenTimesheet(tx, a, siteId, week, reason),
    ),
  exportHours: (ws: Ready, from: unknown, to: unknown) =>
    inRota(ws, (tx, a) => attendance.exportApprovedHours(tx, a, from, to)),
};

// --- CVs (M9.2b) ---------------------------------------------------------------------

export const cvApi = {
  /** CVs on an application, or null if the member can't see it. */
  list: (ws: Ready, applicationId: string) =>
    inRecruitment(ws, (tx, a) =>
      recruitment.listDocuments(tx, a, applicationId),
    ),
  storageReady: cv.cvStorageReady,
  upload: cv.uploadCv,
  download: cv.downloadCv,
  remove: cv.removeCv,
};

// --- Vacancy sharing (M9.2a) -------------------------------------------------------

export type { PublicVacancy } from "./public-vacancy";

/** The public (unauthenticated) vacancy page. Counts a view when source is link or qr. */
export const getPublicVacancy = (
  code: string,
  source: "link" | "qr" | "none",
) =>
  serverEnv().DATABASE_URL
    ? publicVacancyQuery(db(), code, source)
    : Promise.resolve({ state: "missing" } as const);

export type { PublicApplyOutcome } from "./public-application";

/**
 * An online application from the share link (M9.3). The rate-limit hash is
 * keyed with the server's secret, so stored hashes can't be matched to
 * addresses without it.
 */
export const applyOnline = (input: {
  code: string;
  fields: Record<string, unknown>;
  file: { name: string; bytes: Uint8Array } | null;
  clientAddress: string;
}) => {
  const env = serverEnv();
  if (!env.DATABASE_URL || !env.BETTER_AUTH_SECRET)
    return Promise.resolve({ kind: "missing" } as const);
  return submitPublicApplication(db(), {
    ...input,
    hashKey: env.BETTER_AUTH_SECRET,
  });
};

/** Whether candidates can attach a CV in this deployment. */
export const onlineCvUploadsOn = cv.cvStorageReady;

/** The full share link for a code (the QR code adds ?s=qr so scans are counted separately). */
export const vacancyShareUrl = (code: string, viaQr = false) =>
  `${serverEnv().APP_URL.replace(/\/$/, "")}/jobs/${code}${viaQr ? "?s=qr" : ""}`;

export const vacancySharingApi = {
  update: (ws: Ready, vacancyId: string, cmd: recruitment.ShareCommand) =>
    inRecruitment(ws, (tx, a) =>
      recruitment.updateSharing(tx, a, vacancyId, cmd),
    ),
};

// --- Push notifications (M12) ------------------------------------------------------

export const pushApi = {
  /** The public key the browser needs, or null when push is off. */
  publicKey: () => pushKeys()?.publicKey ?? null,
  subscribe: (ws: Ready, raw: unknown) => push.saveSubscription(db(), ws, raw),
  unsubscribe: (ws: Ready, endpoint: unknown) =>
    push.removeSubscription(db(), ws, endpoint),
  isOn: (ws: Ready) => push.hasSubscription(db(), ws),
};

// --- Documents to sign (M13) -------------------------------------------------------------

const signingDeps = async (): Promise<signingFiles.SigningDeps> => ({
  client: db(),
  store: await blobStore(),
  storeFor: blobStoreFor,
});
const inSigning = <T>(
  ws: Ready,
  fn: (tx: TenantTx, a: signing.Actor) => Promise<T>,
) => withWorkspace(ws, (tx) => fn(tx, actorOf(ws)));

export const signingApi = {
  starterPacks: (ws: Ready) => inSigning(ws, signing.starterPacks),
  jobTitles: (ws: Ready) => inSigning(ws, signing.jobTitles),
  createStarterPack: (
    ws: Ready,
    raw: Parameters<typeof signing.createStarterPack>[2],
  ) => inSigning(ws, (tx, a) => signing.createStarterPack(tx, a, raw)),
  archiveStarterPack: (ws: Ready, id: unknown) =>
    inSigning(ws, (tx, a) => signing.archiveStarterPack(tx, a, id)),
  sendStarterPack: (ws: Ready, employeeId: unknown) =>
    inSigning(ws, (tx, a) => signing.sendStarterPack(tx, a, employeeId)),
  storageReady: async () => (await blobStore()) !== null,
  canManage: (ws: Ready) => signing.canManage(actorOf(ws)),
  library: (ws: Ready) => inSigning(ws, signing.library),
  uploadPolicy: async (
    ws: Ready,
    title: unknown,
    file: { name: string; bytes: Uint8Array },
  ) => signingFiles.uploadPolicy(await signingDeps(), ws, title, file),
  archivePolicy: (ws: Ready, id: unknown) =>
    inSigning(ws, (tx, a) => signing.archivePolicy(tx, a, id)),
  personRequests: (ws: Ready, employeeId: unknown) =>
    inSigning(ws, (tx, a) => signing.personRequests(tx, a, employeeId)),
  sendPolicies: (ws: Ready, employeeId: unknown, ids: unknown) =>
    inSigning(ws, (tx, a) => signing.sendPolicies(tx, a, employeeId, ids)),
  uploadContract: async (
    ws: Ready,
    employeeId: unknown,
    title: unknown,
    file: { name: string; bytes: Uint8Array },
  ) =>
    signingFiles.uploadContract(
      await signingDeps(),
      ws,
      employeeId,
      title,
      file,
    ),
  withdraw: (ws: Ready, requestId: unknown) =>
    inSigning(ws, (tx, a) => signing.withdrawRequest(tx, a, requestId)),
  mine: (ws: Ready) => inSigning(ws, signing.myRequests),
  open: async (ws: Ready, requestId: unknown, which: "original" | "signed") =>
    signingFiles.openFile(await signingDeps(), ws, requestId, which),
  sign: async (ws: Ready, requestId: unknown, name: unknown, agreed: unknown) =>
    signingFiles.sign(await signingDeps(), ws, requestId, name, agreed),
  countersign: async (ws: Ready, requestId: unknown, name: unknown) =>
    signingFiles.countersign(await signingDeps(), ws, requestId, name),
};

// --- Welcoming a new starter at hire (M14.1, D4) ---------------------------------

export interface WelcomeOutcome {
  invite:
    | { state: "emailed" | "link"; link: string }
    | { state: "skipped"; reason: string };
  pack:
    { state: "sent"; documents: number } | { state: "skipped"; reason: string };
}

/**
 * After a hire: invites the new starter to TeamHappi (emailed, link kept as a
 * backup) and sends the starter pack for their job title. Each step runs on
 * its own and only with the right permission; a failure never undoes the hire.
 */
export async function welcomeNewStarter(
  ws: Ready,
  employeeId: string,
  want: { invite: boolean; pack: boolean },
): Promise<WelcomeOutcome> {
  let invite: WelcomeOutcome["invite"] = {
    state: "skipped",
    reason: "Not requested.",
  };
  let pack: WelcomeOutcome["pack"] = {
    state: "skipped",
    reason: "Not requested.",
  };
  if (want.invite) {
    const who = await withWorkspace(ws, async (tx) => {
      const [e, role] = await Promise.all([
        tx.employee.findUnique({
          where: { tenantId_id: { tenantId: ws.tenant.id, id: employeeId } },
          select: { email: true, primarySiteId: true, membershipId: true },
        }),
        tx.role.findFirst({
          where: { tenantId: ws.tenant.id, key: "worker", isSystem: true },
          select: { id: true },
        }),
      ]);
      return { e, roleId: role?.id ?? null };
    });
    if (!appEmailProvider(serverEnv()))
      invite = {
        state: "skipped",
        reason: "Email isn't set up yet, so invite them from their record.",
      };
    else if (!who.e?.email)
      invite = {
        state: "skipped",
        reason: "They have no email address on their record.",
      };
    else if (who.e.membershipId)
      invite = {
        state: "skipped",
        reason: "They already have a TeamHappi login.",
      };
    else if (!who.roleId || !who.e.primarySiteId)
      invite = {
        state: "skipped",
        reason: "Give them a site first, then invite them from their record.",
      };
    else {
      const r = await manageMembers.invite(ws, {
        email: who.e.email,
        roleId: who.roleId,
        siteId: who.e.primarySiteId,
        employeeId,
      });
      if (!r.ok) invite = { state: "skipped", reason: r.message };
      else {
        const emailed = await emailInvitation(ws, r.data.email, r.data.token);
        invite = {
          state: emailed ? "emailed" : "link",
          link: invitationLinkFor(r.data.token),
        };
      }
    }
  }
  if (want.pack) {
    const r = await withWorkspace(ws, (tx) =>
      signing.sendStarterPack(tx, actorOf(ws), employeeId),
    );
    pack = !r.ok
      ? { state: "skipped", reason: r.message }
      : r.data.packs === 0
        ? {
            state: "skipped",
            reason: "No starter pack matches their job title.",
          }
        : { state: "sent", documents: r.data.sent };
  }
  return { invite, pack };
}

// --- Personal and bank details (M14.2) ------------------------------------------------

const personalCipher = () => personal.cipherFromEnv(serverEnv());
const inPersonal = <T>(
  ws: Ready,
  fn: (tx: TenantTx, a: personal.Actor) => Promise<T>,
) => withWorkspace(ws, (tx) => fn(tx, actorOf(ws)));

export const personalApi = {
  /** Whether NI and bank fields are switched on (the key is set). */
  sensitiveOn: () => personalCipher() !== null,
  ownId: (ws: Ready) => inPersonal(ws, personal.ownEmployeeId),
  view: (ws: Ready, employeeId: unknown) =>
    inPersonal(ws, (tx, a) => personal.viewDetails(tx, a, employeeId)),
  saveAbout: (ws: Ready, employeeId: unknown, raw: personal.AboutInput) =>
    inPersonal(ws, (tx, a) =>
      personal.saveAbout(
        tx,
        a,
        employeeId,
        raw,
        personalCipher(),
        onboarding.todayIn(ws.tenant.timezone),
      ),
    ),
  saveBank: (
    ws: Ready,
    employeeId: unknown,
    raw: Parameters<typeof personal.saveBank>[3],
  ) =>
    inPersonal(ws, (tx, a) =>
      personal.saveBank(tx, a, employeeId, raw, personalCipher()),
    ),
  reveal: (ws: Ready, employeeId: unknown, field: unknown) =>
    inPersonal(ws, (tx, a) =>
      personal.reveal(tx, a, employeeId, field, personalCipher()),
    ),
};

// --- Offer letters (M14.3) -------------------------------------------------------------

const offerDeps = async (): Promise<offerFiles.OfferDeps> => ({
  client: db(),
  store: await blobStore(),
  storeFor: blobStoreFor,
  email: appEmailProvider(serverEnv()),
  appUrl: serverEnv().APP_URL,
});

export const offerApi = {
  list: (ws: Ready, applicationId: unknown) =>
    inRecruitment(ws, (tx, a) => recruitment.offersFor(tx, a, applicationId)),
  send: async (
    ws: Ready,
    applicationId: unknown,
    title: unknown,
    file: { name: string; bytes: Uint8Array },
  ) => offerFiles.sendOffer(await offerDeps(), ws, applicationId, title, file),
  withdraw: (ws: Ready, offerId: unknown) =>
    inRecruitment(ws, (tx, a) => recruitment.withdrawOffer(tx, a, offerId)),
  staffFile: async (
    ws: Ready,
    offerId: unknown,
    which: "original" | "signed",
  ) => offerFiles.staffOfferFile(await offerDeps(), ws, offerId, which),
};

/** The applicant's private offer link (no login). */
export const publicOffer = {
  view: (token: unknown) =>
    serverEnv().DATABASE_URL
      ? offerFiles.viewOffer(db(), token)
      : Promise.resolve({ state: "missing" } as const),
  file: async (token: unknown) =>
    offerFiles.offerFile(await offerDeps(), token),
  respond: async (
    token: unknown,
    decision: unknown,
    name: unknown,
    agreed: unknown,
  ) =>
    offerFiles.respondToOffer(await offerDeps(), token, decision, name, agreed),
};
