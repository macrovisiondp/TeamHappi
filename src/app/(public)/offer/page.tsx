import type { Metadata } from "next";

import { PublicOffer } from "@/features/offers/public-offer";

export const metadata: Metadata = {
  title: "Your job offer",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** M14.3: an applicant reads and answers their offer through a private link. */
export default function OfferPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Your job offer</h1>
      <PublicOffer />
    </>
  );
}
