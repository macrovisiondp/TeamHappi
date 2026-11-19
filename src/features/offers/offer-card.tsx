import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

import { SendOfferForm, WithdrawOfferButton } from "./controls";

// The offer letter card on an application (M14.3).

type Offers = {
  canSend: boolean;
  atOffer: boolean;
  hasEmail: boolean;
  offers: {
    id: string;
    title: string;
    status: "sent" | "expired" | "accepted" | "declined" | "withdrawn";
    sentAt: Date;
    expiresAt: Date;
    respondedAt: Date | null;
    signedName: string | null;
    hasSignedCopy: boolean;
  }[];
};

const STATUS: Record<
  Offers["offers"][number]["status"],
  { label: string; tone: Tone }
> = {
  sent: { label: "Waiting for an answer", tone: "warning" },
  expired: { label: "Expired", tone: "neutral" },
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

const link =
  "inline-flex min-h-11 items-center text-sm font-semibold text-forest underline underline-offset-4";

export function OfferCard({
  applicationId,
  data,
  storageReady,
}: {
  applicationId: string;
  data: Offers;
  storageReady: boolean;
}) {
  const waiting = data.offers.some((o) => o.status === "sent");
  if (!data.atOffer && data.offers.length === 0) return null;
  return (
    <Card aria-labelledby="offer-heading" className="gap-3">
      <CardTitle id="offer-heading">Offer letter</CardTitle>
      <CardDescription>
        The candidate gets a private link by email, reads the letter and accepts
        (by typing their name) or declines. No login needed.
      </CardDescription>
      {data.offers.length ? (
        <ul className="flex flex-col gap-2">
          {data.offers.map((o) => (
            <li
              key={o.id}
              className="flex flex-col gap-2 rounded-[10px] border border-line-strong p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{o.title}</p>
                <Badge tone={STATUS[o.status].tone}>
                  {STATUS[o.status].label}
                </Badge>
              </div>
              <p className="text-ink-muted">
                Sent {formatDate(o.sentAt)}
                {o.status === "sent"
                  ? ` · link works until ${formatDate(o.expiresAt)}`
                  : ""}
                {o.respondedAt
                  ? ` · answered ${formatDate(o.respondedAt)}`
                  : ""}
                {o.signedName ? ` · signed by ${o.signedName}` : ""}
              </p>
              {data.canSend ? (
                <div className="flex flex-wrap items-center gap-4">
                  <a
                    href={`/recruitment/offer-file/${o.id}`}
                    target="_blank"
                    rel="noopener"
                    className={link}
                  >
                    Letter<span className="sr-only">: {o.title}</span>
                  </a>
                  {o.hasSignedCopy ? (
                    <a
                      href={`/recruitment/offer-file/${o.id}?v=signed`}
                      className={link}
                    >
                      Download signed offer
                      <span className="sr-only">: {o.title}</span>
                    </a>
                  ) : null}
                  {o.status === "sent" ? (
                    <WithdrawOfferButton offerId={o.id} title={o.title} />
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {data.canSend && data.atOffer && !waiting ? (
        !storageReady ? (
          <p className="text-sm text-ink-muted">
            Document storage isn&rsquo;t switched on yet.
          </p>
        ) : !data.hasEmail ? (
          <p className="text-sm text-ink-muted">
            Add the candidate&rsquo;s email address first, so the offer can
            reach them.
          </p>
        ) : (
          <SendOfferForm applicationId={applicationId} />
        )
      ) : null}
    </Card>
  );
}
