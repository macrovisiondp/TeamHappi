import Link from "next/link";

export function Brand() {
  return (
    <Link
      href="/"
      className="flex w-fit items-center gap-2.5 rounded-[10px] font-heading text-lg font-bold tracking-tight text-ink"
    >
      <span
        aria-hidden="true"
        className="grid size-9 place-items-center rounded-xl bg-forest text-sm font-bold text-white shadow-sm"
      >
        TH
      </span>
      <span>
        Team<span className="text-forest">Happi</span>
      </span>
    </Link>
  );
}
