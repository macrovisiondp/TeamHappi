// Public pages (M9.2a: shared vacancies). No session, no organisation context:
// pages read only through narrowly scoped database functions. The logo isn't a
// link: candidates have nothing to do in TeamHappi itself.
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center p-4">
          <span className="flex items-center gap-2.5 font-heading text-lg font-bold tracking-tight text-ink">
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-xl bg-forest text-sm font-bold text-white shadow-sm"
            >
              TH
            </span>
            <span>
              Team<span className="text-forest">Happi</span>
            </span>
          </span>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 outline-none"
      >
        {children}
      </main>
    </div>
  );
}
