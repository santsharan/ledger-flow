import type { ReactNode } from "react";

export function DataTable<T>({
  columns,
  rows,
  rowKey,
}: {
  columns: readonly { key: string; header: string; render: (row: T) => ReactNode }[];
  rows: readonly T[];
  rowKey: (row: T) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-panel">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-line bg-paper text-xs uppercase tracking-wide text-ink-soft">
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="px-3 py-2 font-medium">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-line last:border-0">
              {columns.map((column) => (
                <td key={column.key} className="px-3 py-2 align-top">
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  offset,
  limit,
  count,
  onChange,
}: {
  offset: number;
  limit: number;
  count: number;
  onChange: (offset: number) => void;
}) {
  const page = Math.floor(offset / limit) + 1;
  return (
    <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
      <p className="text-ink-soft">
        Page {page}
        {count === limit ? "" : " · end of results"}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded border border-line px-2 py-1 disabled:opacity-40"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Previous
        </button>
        <button
          type="button"
          className="rounded border border-line px-2 py-1 disabled:opacity-40"
          disabled={count < limit}
          onClick={() => onChange(offset + limit)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
