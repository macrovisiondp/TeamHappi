// Public API of the recruitment module (M9.1). Other code uses only this file.
// Functions take a tenant-scoped transaction (withTenant) and an Actor from
// the server session; see src/lib/workspace/index.ts for the wrappers pages use.

export {
  Rollback,
  addApplication,
  addNote,
  anonymiseCandidate,
  closeApplication,
  getApplication,
  getSettings,
  getVacancy,
  hire,
  hiredFrom,
  interviewSchedule,
  listVacancies,
  moveStage,
  possibleMatches,
  retentionReview,
  saveSettings,
  saveVacancy,
  scheduleInterview,
  setVacancyStatus,
  updateInterview,
  vacancyOptions,
  type InterviewCommand,
  type Result,
} from "./service";
export {
  CV_MAX_BYTES,
  CV_MAX_PER_APPLICATION,
  CV_TYPES,
  cleanFileName,
  inspectCv,
  listDocuments,
  markDeleted,
  mayUpload,
  openDocument,
  pendingDeletions,
  recordUpload,
  removeDocument,
  type CvContentType,
} from "./documents";
export {
  PRIVACY_NOTICE_VERSION,
  parsePublicApplication,
  publicApplicationSchema,
  type PublicApplication,
} from "./public-apply";
export {
  isPublicCode,
  newPublicCode,
  updateSharing,
  type ShareCommand,
} from "./sharing";
export {
  DEFAULT_STAGE_LABELS,
  WORKING_STAGES,
  addMonths,
  isWorkingStage,
  mayHire,
  mayMove,
  parsePay,
  reviewDueOn,
  stageLabels,
  todayIn,
  utcToZoned,
  zonedToUtc,
  type Actor,
  type Stage,
  type WorkingStage,
} from "./policy";
