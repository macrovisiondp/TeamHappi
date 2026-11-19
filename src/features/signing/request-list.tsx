import { Badge, type Tone } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import type { RequestView } from "@/modules/signing";

import { RequestActions, SignForm } from "./controls";

// One list for both sides (M13): a person's own documents on My onboarding
// (they sign), and a person's documents on their record for managers
// (countersign, withdraw). Files open through an audited route.

const STATUS: Record<RequestView["status"], { label: string; tone: Tone }> = {
  awaiting_employee: { label: "Waiting for signature", tone: "warning" },
  awaiting_countersign: { label: "Waiting for countersignature", tone: "info" },
  completed: { label: "Signed", tone: "success" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

const fileHref = (id: string, which: "original" | "signed") =>
  `/onboarding/documents/file/${id}${which === "signed" ? "?v=signed" : ""}`;

const linkClass =
  "inline-flex min-h-11 items-center text-sm font-semibold text-forest underline underline-offset-4";

export function RequestList({
  requests,
  side,
}: {
  requests: readonly RequestView[];
  side: "employee" | "manager";
}) {
  return (
    <ul className="flex flex-col gap-3">
      {requests.map((r) => {
        const s = STATUS[r.status];
        return (
          <li
            key={r.id}
            className="flex flex-col gap-2 rounded-[10px] border border-line-strong p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold">{r.title}</p>
              <Badge tone={s.tone}>{s.label}</Badge>
              {r.kind === "contract" ? (
                <Badge tone="neutral">Contract</Badge>
              ) : null}
            </div>
            <p className="text-ink-muted">
              Sent {formatDate(r.sentAt)}
              {r.signedAt
                ? ` · signed ${formatDate(r.signedAt)} by ${r.signedName}`
                : ""}
              {r.countersignedAt
                ? ` · countersigned ${formatDate(r.countersignedAt)} by ${r.countersignedName}`
                : ""}
            </p>
            <div className="flex flex-wrap gap-4">
              {r.status !== "withdrawn" ? (
                <a
                  href={fileHref(r.id, "original")}
                  className={linkClass}
                  target="_blank"
                  rel="noopener"
                >
                  {r.status === "awaiting_employee" && side === "employee"
                    ? "Read the document"
                    : "Original"}
                  <span className="sr-only">: {r.title}</span>
                </a>
              ) : null}
              {r.hasSignedCopy ? (
                <a href={fileHref(r.id, "signed")} className={linkClass}>
                  Download signed copy
                  <span className="sr-only">: {r.title}</span>
                </a>
              ) : null}
            </div>
            {side === "employee" && r.status === "awaiting_employee" ? (
              <SignForm requestId={r.id} title={r.title} />
            ) : null}
            {side === "employee" && r.status === "awaiting_countersign" ? (
              <p>
                You&rsquo;ve signed. It&rsquo;s now with your employer to
                countersign.
              </p>
            ) : null}
            {side === "manager" &&
            (r.status === "awaiting_employee" ||
              r.status === "awaiting_countersign") ? (
              <RequestActions
                requestId={r.id}
                title={r.title}
                canCountersign={r.status === "awaiting_countersign"}
                canWithdraw
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
