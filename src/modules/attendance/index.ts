// Public API of the attendance module (M11.1). Other code uses only this file.
// Functions take a tenant-scoped transaction (withTenant) and an Actor from the
// server session; see src/lib/workspace/index.ts for the wrappers pages use.

export {
  attendanceSites,
  correctEntry,
  recordEntry,
  removeEntry,
  saveSettings,
  whosIn,
  type TimesInput,
} from "./service";
export { clockIn, clockOut, myClock, toggleBreak } from "./self";
export {
  approveTimesheet,
  csvCell,
  exportApprovedHours,
  hoursDecimal,
  reopenTimesheet,
  timesheet,
  weekBounds,
  type TimesheetFlag,
} from "./timesheets";
export {
  DEFAULT_LIMITS,
  FLAG_LABELS,
  STATUS_LABELS,
  breakMinutes,
  entryFlags,
  matchShift,
  personStatus,
  workedMinutes,
  type Flag,
  type Limits,
  type Status,
} from "./policy";
export type { Actor, Result } from "./shared";
