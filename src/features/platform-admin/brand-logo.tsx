"use client";

import { ImageUpload } from "@/components/ui/image-upload";
import { LogoBox } from "@/features/setup/image-controls";

import { removeBrandLogo, uploadBrandLogo } from "./actions";

/** The TeamHappi logo, shown on sign-in and in every top bar. */
export function BrandLogoUpload({ current }: { current: string | null }) {
  return (
    <ImageUpload
      current={current}
      shape="logo"
      label="Upload the TeamHappi logo"
      upload={uploadBrandLogo}
      remove={removeBrandLogo}
      savedMessage="TeamHappi logo updated"
      removedMessage="TeamHappi logo removed"
      preview={<LogoBox src={current} />}
    />
  );
}
