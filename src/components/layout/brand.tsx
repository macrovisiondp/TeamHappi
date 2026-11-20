"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * The TeamHappi mark. When TeamHappi staff have uploaded a logo (Platform
 * Admin › Settings), that's shown instead; until it has loaded, or if there
 * isn't one, the built-in mark is shown.
 */
export function Brand() {
  const [logo, setLogo] = useState<"loading" | "ok" | "none">("loading");
  return (
    <Link
      href="/"
      aria-label="TeamHappi home"
      className="flex w-fit items-center gap-2.5 rounded-[10px] font-heading text-lg font-bold tracking-tight text-ink"
    >
      {logo !== "none" ? (
        // eslint-disable-next-line @next/next/no-img-element -- small image served by our own route
        <img
          src="/media/brand"
          alt=""
          className={
            logo === "ok" ? "h-9 max-w-[10rem] object-contain" : "hidden"
          }
          onLoad={() => setLogo("ok")}
          onError={() => setLogo("none")}
        />
      ) : null}
      {logo !== "ok" ? (
        <>
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-xl bg-forest text-sm font-bold text-white shadow-sm"
          >
            TH
          </span>
          <span>
            Team<span className="text-forest">Happi</span>
          </span>
        </>
      ) : null}
    </Link>
  );
}
