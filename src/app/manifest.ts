import type { MetadataRoute } from "next";

import { BRAND_FOREST, BRAND_PAPER } from "@/features/brand/app-icon";

// Makes TeamHappi installable on phones (M12): "Add to Home Screen" opens it
// full screen like an app. No app store.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TeamHappi",
    short_name: "TeamHappi",
    description: "Your shifts, clocking and training at work.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: BRAND_PAPER,
    theme_color: BRAND_FOREST,
    icons: [
      { src: "/app-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/app-icon/512", sizes: "512x512", type: "image/png" },
      {
        src: "/app-icon/maskable-512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
