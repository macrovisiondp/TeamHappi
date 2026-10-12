import Link from "next/link";

import { Brand } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
          <Brand />
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-6 p-4 outline-none md:p-8"
      >
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Workforce management for hospitality teams
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Recruitment, onboarding, training, rotas and attendance for
          restaurants and multi-site hospitality groups, all in one place.
        </p>
        <p className="w-fit rounded-md bg-secondary px-3 py-1 text-sm text-secondary-foreground">
          In development. Accounts are created by Macrovision; there is no
          public sign-up.
        </p>
        <div>
          <Button asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
