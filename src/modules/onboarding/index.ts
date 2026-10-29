// Public API of the onboarding module (M7.1, M7.2). Other code uses only this
// file. Functions take a tenant-scoped transaction (withTenant) and an Actor
// from the server session; see src/lib/workspace/index.ts for the wrappers
// pages use.

export {
  addDocument,
  addSuggestedTemplates,
  archiveTemplate,
  archiveTemplateTask,
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
  updateDocument,
  updateTask,
  type CaseSummary,
  type Dashboard,
  type DocumentCommand,
  type TaskCommand,
  type TemplateSummary,
} from "./service";
export { assignableMembers, type Result } from "./shared";
export {
  getRightToWork,
  isClearedToWork,
  recordRtwCheck,
  rtwAttentionCount,
  rtwFollowUps,
  type RtwAttention,
  type RtwCommand,
} from "./compliance";
export {
  FOLLOW_UP_WINDOW_DAYS,
  clearanceOf,
  currentOf,
  documentProgressOf,
  looksLikeIdentifier,
  mayCloseDocument,
  rtwCovers,
  rtwStateOn,
  validateRtw,
  type Clearance,
  type DocumentProgress,
  type DocumentStatus,
  type RtwFacts,
  type RtwList,
  type RtwMethod,
  type RtwOutcome,
  type RtwState,
} from "./compliance-policy";
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
