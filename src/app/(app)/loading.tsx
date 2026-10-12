export default function Loading() {
  return (
    <div role="status" className="flex max-w-3xl flex-col gap-6">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-32 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
