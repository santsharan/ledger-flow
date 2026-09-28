export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-panel px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-ink-soft">{body}</p>
    </div>
  );
}

export function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-4">
      <p className="font-medium text-danger">{title}</p>
      <p className="mt-1 text-sm text-ink">{body}</p>
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <p className="text-sm text-ink-soft" role="status">
      {label}
    </p>
  );
}
