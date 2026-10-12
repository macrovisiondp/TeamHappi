import { CalendarDays, ClipboardCheck, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";

import { Brand } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";

const POINTS = [
  {
    icon: Users,
    text: "Hire and onboard new starters with every check recorded",
  },
  { icon: CalendarDays, text: "Plan rotas across every site and team" },
  { icon: ClipboardCheck, text: "Keep training and compliance up to date" },
  {
    icon: ShieldCheck,
    text: "Each organisation's data kept strictly separate",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 p-4">
          <Brand />
          <Button asChild variant="secondary">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 py-12 outline-none md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:px-8"
      >
        <div className="flex flex-col gap-6">
          <p className="w-fit rounded-full bg-sage px-3 py-1 text-sm font-semibold text-forest-strong">
            People first. Every shift.
          </p>
          <h1 className="text-4xl font-bold md:text-5xl">
            Workforce management made for hospitality teams
          </h1>
          <p className="max-w-xl text-lg text-ink-muted">
            Recruitment, onboarding, training, rotas and attendance for
            restaurants, cafés and multi-site groups across the UK, all in one
            place.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/sign-in">Sign in to TeamHappi</Link>
            </Button>
            <p className="text-sm text-ink-muted">
              Accounts are set up by Macrovision. There&apos;s no public
              sign-up.
            </p>
          </div>
        </div>
        <ul className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-6 shadow-card">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-forest">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <span className="pt-2 text-sm font-medium">{text}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
