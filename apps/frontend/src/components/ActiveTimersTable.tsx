import { useMemo } from 'react';
import type { ActiveTimerItem } from '../api/diagnostics';

type ActiveTimersTableProps = {
  timers?: ActiveTimerItem[];
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

function remaining(expiresAt?: string) {
  if (!expiresAt) return '—';
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return '—';
  const diffMs = end - Date.now();
  if (diffMs <= 0) return 'expired';

  const totalSeconds = Math.floor(diffMs / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs}s`;
}

export function ActiveTimersTable({
  timers,
  isLoading,
  isError,
  errorMessage,
  onRefresh,
  isRefreshing,
}: ActiveTimersTableProps) {
  const visibleTimers = useMemo(
    () => [...(timers ?? [])].filter((item) => item.active !== false).sort((a, b) => b.id - a.id),
    [timers],
  );

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Active Timers</h2>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-100 hover:bg-slate-800"
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {isLoading && <p className="text-sm text-slate-300">Loading active timers...</p>}

      {isError && (
        <p className="rounded-md border border-red-700/40 bg-red-950/40 p-3 text-sm text-red-200">
          Failed to load timers: {errorMessage ?? 'Unknown error'}
        </p>
      )}

      {!isLoading && !isError && visibleTimers.length === 0 && (
        <p className="rounded-md border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">No active timers</p>
      )}

      {!isLoading && !isError && visibleTimers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-2 py-2">Target</th>
                <th className="px-2 py-2">Timer Type</th>
                <th className="px-2 py-2">Started</th>
                <th className="px-2 py-2">Expires</th>
                <th className="px-2 py-2">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {visibleTimers.map((item) => (
                <tr key={item.id} className="border-t border-slate-800">
                  <td className="px-2 py-2">
                    {item.targetType ?? 'target'} #{item.targetId ?? '—'}
                  </td>
                  <td className="px-2 py-2">auto-off</td>
                  {/* TODO: backend timer payload does not include a timer subtype; show generic type for now. */}
                  <td className="px-2 py-2 whitespace-nowrap">{toDate(item.startedAt)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{toDate(item.expiresAt)}</td>
                  <td className="px-2 py-2">{remaining(item.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
