// Public API of the personal-details module (M14.2). Other code uses only this file.

export { cipherFromEnv, fieldCipher, type FieldCipher } from "./cipher";
export {
  normaliseAccountNumber,
  normaliseNi,
  normaliseSortCode,
  ownEmployeeId,
  reveal,
  saveAbout,
  saveBank,
  viewDetails,
  type AboutInput,
  type Actor,
  type DetailsView,
  type Result,
  type Revealed,
} from "./service";
