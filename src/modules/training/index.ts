// Public API of the training module (M8.1). Other code uses only this file.
// Functions take a tenant-scoped transaction (withTenant) and an Actor from
// the server session; see src/lib/workspace/index.ts for the wrappers pages use.

export {
  addSuggestedCourses,
  archiveCourse,
  archiveRule,
  getCourse,
  listCourses,
  matrix,
  personTraining,
  recordTraining,
  saveCourse,
  saveRule,
  voidRecord,
  type CourseSummary,
  type Matrix,
  type RecordCommand,
  type Result,
} from "./service";
export {
  CATEGORIES,
  addDays,
  addMonths,
  currentRecord,
  personUpToDate,
  requirementsFor,
  ruleApplies,
  ruleDueOn,
  statusOf,
  todayIn,
  type Actor,
  type Category,
  type CourseStatus,
  type Person,
  type RecordFacts,
  type Requirement,
  type Rule,
  type TrainingStatus,
} from "./policy";
export { SUGGESTED_COURSES } from "./suggested";
export {
  referralUrl,
  type PartnerCourse,
  type TrainingPartner,
  type TrainingProviderAdapter,
} from "./providers";
