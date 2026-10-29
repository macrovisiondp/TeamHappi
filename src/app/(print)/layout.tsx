// Print-only pages (M9.2a: vacancy posters). No app navigation, so the page
// prints as it looks. Each page checks the session itself.
export default function PrintLayout({ children }: LayoutProps<"/">) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="min-h-dvh bg-white text-ink outline-none"
    >
      {children}
    </main>
  );
}
