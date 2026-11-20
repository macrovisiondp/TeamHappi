// Public API of the rota module (M10.1). Other code uses only this file.
// Functions take a tenant-scoped transaction (withTenant) and an Actor from
// the server session; see src/lib/workspace/index.ts for the wrappers pages use.

export {
  assignShift,
  cancelShift,
  copyPreviousWeek,
  decideChange,
  decideRequest,
  getWeek,
  publishWeek,
  rotaSites,
  saveShift,
  unassignShift,
  type Result,
  type ShiftInput,
} from "./service";
export {
  addUnavailability,
  markShiftsSeen,
  removeUnavailability,
  requestChange,
  respondToSwap,
  withdrawChange,
  type UnavailabilityInput,
  myShiftUpdates,
  myShifts,
  requestShift,
  withdrawRequest,
} from "./self";
export {
  membersWithChangedShifts,
  publishedShifts,
  type PublishedShift,
} from "./feed";
export {
  addDays,
  clashesWithUnavailability,
  coverGaps,
  describeUnavailability,
  type UnavailableRule,
  formatMinutes,
  mondayOf,
  shiftTimes,
  todayIn,
  utcToZoned,
  weekDays,
  workedMinutes,
  workingTimeWarnings,
  zonedToUtc,
  type Actor,
  type TimedShift,
  type Warning,
} from "./policy";
