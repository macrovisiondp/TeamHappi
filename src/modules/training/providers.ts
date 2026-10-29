// External training partners: the shape for M8.3 and later. NOTHING here is
// connected in M8.1: no partner data, no provider calls, no outbound links in
// the UI. It fixes two things early so they aren't redesigned later:
//
// 1. Where partner courses sit: a partner course (listed and approved by
//    Macrovision on the platform) MAPS TO a course category, or to an
//    organisation's own course. It's never a course of the organisation's, and
//    a referral is never a completion: managers still record and verify
//    completions (decision D5).
// 2. Referral links: built only from an approved partner's https base URL and
//    an approved referral identifier. They never carry names, email
//    addresses, employee, membership or tenant ids, or any other personal data.

import type { Category } from "./policy";

/** A partner listing (platform-managed, M8.3). */
export interface TrainingPartner {
  id: string;
  name: string;
  website: string;
  status: "pending" | "approved" | "suspended" | "inactive";
  categories: readonly Category[];
  /** Shown only once Macrovision has verified it. */
  verifiedAccreditation: string | null;
  /** Shown to users when a commercial referral relationship exists. */
  referralDisclosure: string | null;
}

export interface PartnerCourse {
  id: string;
  partnerId: string;
  /** The provider's own identifier, for future catalogue sync. */
  externalCourseId: string | null;
  title: string;
  category: Category;
  referralBaseUrl: string;
  referralId: string;
}

/**
 * Future provider API capabilities (M8.3+). Each needs separate approval,
 * a privacy assessment and a lawful basis before any personal data is sent.
 * No implementation exists in M8.1.
 */
export interface TrainingProviderAdapter {
  readonly providerKey: string;
  syncCatalogue?(): Promise<readonly PartnerCourse[]>;
  /** Would send personal data: consent or another lawful basis required. */
  enrol?(input: { partnerCourseId: string; learnerRef: string }): Promise<{
    enrolmentRef: string;
  }>;
  completionUpdates?(since: Date): Promise<
    readonly {
      enrolmentRef: string;
      completedOn: string;
      certificateRef: string | null;
    }[]
  >;
  verifyCertificate?(
    certificateRef: string,
  ): Promise<"valid" | "invalid" | "unknown">;
}

const REFERRAL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BLOCKED_HOSTS =
  /^(localhost|.*\.local|.*\.internal|\d{1,3}(\.\d{1,3}){3}|\[.*\])$/i;
// Query keys that would identify a person or organisation: never allowed.
const PERSONAL_KEYS =
  /^(e-?mail|name|first_?name|last_?name|surname|phone|user(_?id)?|employee(_?id)?|member(ship)?(_?id)?|tenant(_?id)?|org(anisation|anization)?(_?id)?|dob)$/i;

/**
 * A safe outbound referral link, or null. https only, a public host name, no
 * embedded credentials, no personal-data query keys, and only the approved
 * referral identifier added. The UI opens it with rel="noopener noreferrer".
 */
export function referralUrl(
  baseUrl: string,
  referralId: string,
): string | null {
  if (!REFERRAL_ID.test(referralId)) return null;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname.includes(".") || BLOCKED_HOSTS.test(url.hostname))
    return null;
  if ([...url.searchParams.keys()].some((k) => PERSONAL_KEYS.test(k)))
    return null;
  if (baseUrl.length > 2048) return null;
  url.hash = "";
  url.searchParams.set("ref", referralId);
  return url.toString();
}
