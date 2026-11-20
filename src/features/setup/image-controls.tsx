"use client";

import { Building2 } from "lucide-react";

import { ImageUpload } from "@/components/ui/image-upload";
import { Avatar } from "@/components/ui/misc";

import {
  deleteLogo,
  deletePhoto,
  uploadLogo,
  uploadPhoto,
} from "./image-actions";

/** A person's profile photo (their own, or as their manager). */
export function PhotoUpload({
  employeeId,
  name,
  current,
  own = false,
}: {
  employeeId: string;
  name: string;
  current: string | null;
  own?: boolean;
}) {
  return (
    <ImageUpload
      current={current}
      shape="square"
      label="Add a photo"
      upload={(form) => uploadPhoto(employeeId, form)}
      remove={() => deletePhoto(employeeId)}
      savedMessage={own ? "Your photo is updated" : "Photo updated"}
      removedMessage="Photo removed"
      preview={<Avatar name={name} src={current} size="xl" />}
    />
  );
}

/** The organisation's logo (owners and administrators). */
export function LogoUpload({ current }: { current: string | null }) {
  return (
    <ImageUpload
      current={current}
      shape="logo"
      label="Upload a logo"
      upload={uploadLogo}
      remove={deleteLogo}
      savedMessage="Logo updated"
      removedMessage="Logo removed"
      preview={<LogoBox src={current} />}
    />
  );
}

export function LogoBox({
  src,
  className = "h-16 w-40",
}: {
  src: string | null;
  className?: string;
}) {
  return (
    <span
      className={`grid place-items-center overflow-hidden rounded-lg border border-line bg-surface p-2 ${className}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- small private image served by our own route
        <img
          src={src}
          alt=""
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <Building2 aria-hidden="true" className="size-6 text-ink-muted" />
      )}
    </span>
  );
}
