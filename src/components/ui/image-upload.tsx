"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { reloadWithNote } from "@/components/ui/toast";

// Picture upload (M17): the picture is resized in the browser before it's sent
// (photos to a 256 px square, logos to at most 512 px wide), so uploads are
// small and quick even on a phone. The server checks the result again.

type Result = { ok: true } | { ok: false; message: string };

async function resize(
  file: File,
  shape: "square" | "logo",
): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  let sx = 0,
    sy = 0,
    sw = bitmap.width,
    sh = bitmap.height,
    w: number,
    h: number;
  if (shape === "square") {
    const side = Math.min(sw, sh);
    sx = (sw - side) / 2;
    sy = (sh - side) / 2;
    sw = sh = side;
    w = h = Math.min(256, side);
  } else {
    const scale = Math.min(1, 512 / sw, 256 / sh);
    w = Math.max(1, Math.round(sw * scale));
    h = Math.max(1, Math.round(sh * scale));
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
  const as = (type: string, q?: number) =>
    new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  // WebP keeps logos' transparency and is small; some browsers can't make it.
  const webp = await as("image/webp", 0.88);
  if (webp && webp.type === "image/webp") return webp;
  return shape === "square" ? as("image/jpeg", 0.88) : as("image/png");
}

export function ImageUpload({
  current,
  shape,
  label,
  upload,
  remove,
  savedMessage,
  removedMessage,
  preview,
}: {
  /** Address of the current picture, if there is one. */
  current: string | null;
  shape: "square" | "logo";
  label: string;
  upload: (form: FormData) => Promise<Result>;
  remove?: () => Promise<Result>;
  savedMessage: string;
  removedMessage: string;
  /** How the picture is shown (an avatar, a logo box). */
  preview: React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const choose = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    start(async () => {
      const blob = await resize(file, shape);
      if (!blob) {
        setError("That file isn't a picture we can use. Try a JPEG or PNG.");
        return;
      }
      const form = new FormData();
      form.set("image", blob, "image");
      const r = await upload(form);
      if (!r.ok) setError(r.message);
      else reloadWithNote(savedMessage);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        {preview}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            <ImagePlus aria-hidden="true" />
            {pending ? "Uploading…" : current ? "Change" : label}
          </Button>
          {current && remove ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await remove();
                  if (!r.ok) setError(r.message);
                  else reloadWithNote(removedMessage);
                })
              }
            >
              <Trash2 aria-hidden="true" />
              Remove
            </Button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {error ? <FormError message={error} /> : null}
    </div>
  );
}
