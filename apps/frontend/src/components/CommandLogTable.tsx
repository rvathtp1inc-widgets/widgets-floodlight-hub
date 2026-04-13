import { useMemo } from 'react';
import type { CommandLogItem } from '../api/diagnostics';

type CommandLogTableProps = {
  commands?: CommandLogItem[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRefresh: () => void;
  isRefreshing: boolean;
};

function toDate(value?: string) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function statusPill(success?: boolean) {
  if (success === true) {
    return <span className="inline-flex rounded border border-emerald-600/40 bg-emerald-900/50 px-2 py-0.5 text-xs font-semibold text-emerald-200">success</span>;
  }
  if (success === false) {
    return <span className="inline-flex rounded border border-red-600/40 bg-red-900/50 px-2 py-0.5 text-xs font-semibold text-red-200">failure</span>;
  }
  return <span className="text-slate-400">—</span>;
}

export function CommandLogTable({
  commands,
  isLoading,
  isError,
  errorMessage,
  onRefresh,
  isRefreshing,
}: CommandLogTableProps) {
  const visibleCommands = useMemo(() => [...(commands ?? [])].sort((a, b) => b.id - a.id).slice(0, 100), [commands]);

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Command Log</h2>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-100 hover:bg-slate-800"
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {isLoading && <p className="text-sm text-slate-300">Loading command activity...</p>}

      {isError && (
        <p className="rounded-md border border-red-700/40 bg-red-950/40 p-3 text-sm text-red-200">
          Failed to load commands: {errorMessage ?? 'Unknown error'}
        </p>
      )}

      {!isLoading && !isError && visibleCommands.length === 0 && (
        <p className="rounded-md border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">No recent command activity</p>
      )}

      {!isLoading && !isError && visibleCommands.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-2 py-2">Time</th>
                <th className="px-2 py-2">Target</th>
                <th className="px-2 py-2">Action</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Request</th>
                <th className="px-2 py-2">Response/Error</th>
              </tr>
            </thead>
            <tbody>
              {visibleCommands.map((item) => (
                <tr key={item.id} className="border-t border-slate-800">
                  <td className="whitespace-nowrap px-2 py-2">{toDate(item.createdAt)}</td>
                  <td className="px-2 py-2">floodlight #{item.floodlightId ?? '—'}</td>
                  <td className="px-2 py-2">{item.commandType ?? '—'}</td>
                  <td className="px-2 py-2">{statusPill(item.success)}</td>
                  <td className="px-2 py-2">{item.requestSummary ?? '—'}</td>
                  <td className="px-2 py-2">{item.errorText ?? item.responseSummary ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
