import { Brand } from "@/components/layout/brand";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center p-4">
          <Brand />
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-4 outline-none"
      >
        {children}
      </main>
    </div>
  );
}
