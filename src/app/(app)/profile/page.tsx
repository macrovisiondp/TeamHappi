import {
  CalendarDays,
  ClipboardCheck,
  GraduationCap,
  LifeBuoy,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader, photoSrc } from "@/components/ui/misc";
import { PhotoUpload } from "@/features/setup/image-controls";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { getCurrentUser } from "@/lib/auth";
import { myProfile } from "@/lib/workspace";

export const metadata: Metadata = { title: "My profile" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

const LINKS = [
  { href: "/rota/me", label: "My shifts", icon: CalendarDays },
  { href: "/training/me", label: "My training", icon: GraduationCap },
  {
    href: "/onboarding/me",
    label: "My documents and details",
    icon: ClipboardCheck,
  },
  { href: "/help", label: "Help", icon: LifeBuoy },
] as const;

/** M17: the signed-in person's own profile, with their photo. */
export default async function ProfilePage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const [user, me] = await Promise.all([getCurrentUser(), myProfile(ws)]);
  const name = me
    ? `${me.preferredName || me.givenName} ${me.familyName}`
    : (user?.name ?? "");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="My profile" />
      <Card className="gap-5">
        <div className="flex flex-col gap-1">
          <CardTitle>{name}</CardTitle>
          <CardDescription>
            {[me?.jobTitle, me?.siteName, ws.tenant.name]
              .filter(Boolean)
              .join(" · ")}
          </CardDescription>
          <p className="text-sm text-ink-muted">{user?.email}</p>
        </div>
        {me ? (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Profile photo</h2>
            <PhotoUpload
              own
              employeeId={me.id}
              name={name}
              current={photoSrc(me.id, me.photoId)}
            />
            <p className="text-sm text-ink-muted">
              People in {ws.tenant.name} see it next to your name.
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            You can add a photo once your login is linked to your staff record.
            Ask your manager to invite you from your record.
          </p>
        )}
      </Card>
      {me ? (
        <nav aria-label="Your pages">
          <ul className="grid gap-3 sm:grid-cols-2">
            {LINKS.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-line bg-surface px-4 font-semibold hover:bg-sage"
                >
                  <Icon aria-hidden="true" className="size-5 text-forest" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
