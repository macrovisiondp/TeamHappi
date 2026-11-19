import { ImageResponse } from "next/og";

// The TeamHappi app icon (M12), drawn at build or request time, so there are
// no binary image files in the repository. Forest green with "TH". `maskable`
// keeps the letters inside the safe zone for Android's shaped icons.

export const BRAND_FOREST = "#205b4e";
export const BRAND_PAPER = "#faf8f3";

export function appIcon(size: number, maskable = false) {
  const inset = maskable ? 0 : Math.round(size * 0.06);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: maskable ? BRAND_FOREST : "transparent",
      }}
    >
      <div
        style={{
          width: size - inset * 2,
          height: size - inset * 2,
          borderRadius: maskable ? 0 : Math.round(size * 0.22),
          background: BRAND_FOREST,
          color: BRAND_PAPER,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.round(size * (maskable ? 0.34 : 0.44)),
          fontWeight: 700,
          letterSpacing: -Math.round(size * 0.02),
        }}
      >
        TH
      </div>
    </div>,
    { width: size, height: size },
  );
}
