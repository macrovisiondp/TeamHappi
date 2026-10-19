// Public API of the onboarding module (M7.1). Other code uses only this file.
// Functions take a tenant-scoped transaction (withTenant) and an Actor from the
// server session; see src/lib/workspace/index.ts for the wrappers pages use.

export {
  addSuggestedTemplates,
  archiveTemplate,
  archiveTemplateTask,
  assignableMembers,
  cancelCase,
  caseForEmployee,
  changeCaseOwner,
  dashboard,
  getCase,
  getTemplate,
  listTemplates,
  saveTemplate,
  saveTemplateTask,
  signOffCase,
  startCase,
  startOptions,
  updateTask,
  type CaseSummary,
  type Dashboard,
  type Result,
  type TaskCommand,
  type TemplateSummary,
} from "./service";
export {
  dueDate,
  isIsoDate,
  isOverdue,
  maySignOff,
  mayWaive,
  progressOf,
  templateSuits,
  todayIn,
  type Actor,
  type Progress,
} from "./policy";
export { SUGGESTED_TEMPLATES } from "./suggested";
