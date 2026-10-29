import { Brand } from "@/components/layout/brand";

// Public pages (M9.2a: shared vacancies). No session, no organisation context:
// pages read only through narrowly scoped database functions.
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center p-4">
          <Brand />
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
