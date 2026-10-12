import Link from "next/link";

export function Brand() {
  return (
    <Link
      href="/"
      className="flex w-fit items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
      >
        TH
      </span>
      <span>TeamHappi</span>
    </Link>
  );
}
