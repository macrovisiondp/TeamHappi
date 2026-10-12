import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TeamHappi", template: "%s · TeamHappi" },
  description: "Workforce management for hospitality teams.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfdfd" },
    { media: "(prefers-color-scheme: dark)", color: "#121a1c" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
