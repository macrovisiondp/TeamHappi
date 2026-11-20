import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-4 outline-none"
    >
      <h1 className="text-2xl font-bold tracking-tight">
        We can&rsquo;t find that page
      </h1>
      <p className="text-muted-foreground">
        The link may be out of date, or the page may belong to another
        organisation.
      </p>
      <div>
        <Button asChild>
          <Link href="/">Go to TeamHappi</Link>
        </Button>
      </div>
    </main>
  );
}
