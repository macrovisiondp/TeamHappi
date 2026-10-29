"use client";

import { Copy, Download, Link2, Printer, QrCode } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import {
  ErrorAlert,
  Submit,
  textareaClass,
  useReload,
} from "@/features/onboarding/controls";
import { SetupForm } from "@/features/setup/form";
import { IDLE } from "@/features/setup/form-state";

import { vacancyShareAction } from "./actions";

// Share link and QR code for a vacancy (M9.2a). The server creates the code
// and checks every change; the link shows only the published details.

export function SharePanel({
  vacancyId,
  shareUrl,
  qrDataUrl,
  views,
  howToApply,
  showPay,
  hasPay,
  isOpen,
}: {
  vacancyId: string;
  shareUrl: string | null;
  qrDataUrl: string | null;
  views: { link: number; qr: number };
  howToApply: string | null;
  showPay: boolean;
  hasPay: boolean;
  isOpen: boolean;
}) {
  const [state, action] = useActionState(vacancyShareAction, IDLE);
  useReload(state);
  const [confirm, setConfirm] = useState<null | "regenerate" | "disable">(null);
  const [copied, setCopied] = useState(false);
  const hidden = <input type="hidden" name="vacancyId" value={vacancyId} />;

  return (
    <div className="flex flex-col gap-4">
      {state.status === "error" && !confirm ? (
        <ErrorAlert state={state} />
      ) : null}
      {!shareUrl ? (
        <form action={action} className="flex flex-col gap-3">
          {hidden}
          <input type="hidden" name="intent" value="enable" />
          <p className="text-sm">
            Create a link and QR code to put on posters, social media or your
            website. It shows only the details below, and collects nothing from
            the people who open it.
          </p>
          <Submit label="Create share link">
            <Link2 aria-hidden="true" />
          </Submit>
        </form>
      ) : (
        <>
          {!isOpen ? (
            <Alert tone="warning" title="This vacancy isn't open">
              People opening the link see that it&rsquo;s no longer accepting
              applications. Open the vacancy to show the details again.
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-start gap-6">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL generated on the server
              <img
                src={qrDataUrl}
                alt="QR code for the vacancy's share link"
                width={160}
                height={160}
                className="rounded-[10px] border border-line bg-white p-2"
              />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Field id="share-url" label="Share link">
                <Input
                  id="share-url"
                  value={shareUrl}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(shareUrl);
                    setCopied(true);
                  }}
                >
                  <Copy aria-hidden="true" />
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <Button size="sm" variant="secondary" asChild>
                  <a
                    href={`/recruitment/vacancies/${vacancyId}/qr?format=png`}
                    download
                  >
                    <Download aria-hidden="true" />
                    QR code (PNG)
                  </a>
                </Button>
                <Button size="sm" variant="secondary" asChild>
                  <a
                    href={`/recruitment/vacancies/${vacancyId}/qr?format=svg`}
                    download
                  >
                    <QrCode aria-hidden="true" />
                    QR code (SVG)
                  </a>
                </Button>
                <Button size="sm" variant="secondary" asChild>
                  <Link
                    href={`/poster/vacancy/${vacancyId}`}
                    prefetch={false}
                    target="_blank"
                  >
                    <Printer aria-hidden="true" />
                    Print poster
                    <span className="sr-only"> (opens in a new tab)</span>
                  </Link>
                </Button>
              </div>
              <p className="text-sm text-ink-muted" role="status">
                Opened {views.link} time{views.link === 1 ? "" : "s"} from the
                link and {views.qr} from the QR code (counts only; nothing about
                who opened it).
              </p>
              {copied ? (
                <span className="sr-only" role="status">
                  Link copied
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirm("regenerate")}
            >
              New link
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirm("disable")}
            >
              Remove link
            </Button>
          </div>
        </>
      )}

      <SetupForm
        action={vacancyShareAction}
        submitLabel="Save public details"
        hidden={{ vacancyId, intent: "details" }}
      >
        {(e) => (
          <div className="grid gap-4">
            <Field
              id="field-howToApply"
              label="How to apply (shown on the link)"
              hint='For example "Pop in and ask for Sam" or "Email jobs@yourvenue.co.uk". Online applications come later.'
              error={e.howToApply}
            >
              <textarea
                id="field-howToApply"
                name="howToApply"
                defaultValue={howToApply ?? ""}
                maxLength={1000}
                rows={3}
                aria-describedby="field-howToApply-hint"
                className={textareaClass}
              />
            </Field>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                name="showPay"
                defaultChecked={showPay}
                disabled={!hasPay}
                className="size-5 accent-[var(--brand-forest)]"
              />
              <span className="text-sm font-semibold">
                Show pay on the link
                {hasPay ? "" : " (add pay to the vacancy first)"}
              </span>
            </label>
          </div>
        )}
      </SetupForm>

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm === "regenerate"
            ? "Create a new link?"
            : "Remove the share link?"
        }
        description={
          confirm === "regenerate"
            ? "The current link and any printed QR codes stop working. Use this if the link went somewhere it shouldn't."
            : "The link and any printed QR codes stop working. You can create a new link later."
        }
      >
        <form action={action} className="flex flex-wrap justify-end gap-3">
          {hidden}
          <input type="hidden" name="intent" value={confirm ?? ""} />
          {state.status === "error" ? <ErrorAlert state={state} /> : null}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirm(null)}
          >
            Back
          </Button>
          <Submit
            label={confirm === "regenerate" ? "Create new link" : "Remove link"}
            variant="danger"
          />
        </form>
      </Dialog>
    </div>
  );
}
