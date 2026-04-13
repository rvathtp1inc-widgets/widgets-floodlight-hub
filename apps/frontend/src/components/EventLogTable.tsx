import { useMemo, useState } from 'react';
import type { EventLogItem } from '../api/diagnostics';

type EventFilter = 'all' | 'floodlight' | 'group' | 'accepted' | 'rejected';

type EventLogTableProps = {
  events?: EventLogItem[];
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

export function EventLogTable({
  events,
  isLoading,
  isError,
  errorMessage,
  onRefresh,
  isRefreshing,
}: EventLogTableProps) {
  const [filter, setFilter] = useState<EventFilter>('all');

  const visibleEvents = useMemo(() => {
    const sorted = [...(events ?? [])].sort((a, b) => b.id - a.id).slice(0, 100);
    if (filter === 'all') return sorted;

    return sorted.filter((item) => {
      if (filter === 'floodlight' || filter === 'group') {
        return item.targetType === filter;
      }
      if (filter === 'accepted') {
        return (item.decision ?? '').toLowerCase().includes('accept');
      }
      if (filter === 'rejected') {
        return (item.decision ?? '').toLowerCase().includes('reject');
      }
      return true;
    });
  }, [events, filter]);

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Event Log</h2>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100"
            value={filter}
            onChange={(event) => setFilter(event.target.value as EventFilter)}
          >
            <option value="all">All</option>
            <option value="floodlight">Floodlight</option>
            <option value="group">Group</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-100 hover:bg-slate-800"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-slate-300">Loading events...</p>}

      {isError && (
        <p className="rounded-md border border-red-700/40 bg-red-950/40 p-3 text-sm text-red-200">
          Failed to load events: {errorMessage ?? 'Unknown error'}
        </p>
      )}

      {!isLoading && !isError && visibleEvents.length === 0 && (
        <p className="rounded-md border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">No recent events</p>
      )}

      {!isLoading && !isError && visibleEvents.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-2 py-2">Time</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Target</th>
                <th className="px-2 py-2">Webhook</th>
                <th className="px-2 py-2">Result</th>
                <th className="px-2 py-2">Reason</th>
                <th className="px-2 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map((item) => (
                <tr key={item.id} className="border-t border-slate-800">
                  <td className="px-2 py-2 whitespace-nowrap">{toDate(item.receivedAt ?? item.createdAt)}</td>
                  <td className="px-2 py-2">{item.httpMethod ?? '—'}</td>
                  <td className="px-2 py-2">
                    {item.targetType ?? 'unknown'}
                    {item.targetId ? ` #${item.targetId}` : ''}
                  </td>
                  <td className="px-2 py-2">{item.webhookKey ?? '—'}</td>
                  <td className="px-2 py-2">
                    {item.decision ?? '—'}
                    {item.authResult ? ` / ${item.authResult}` : ''}
                  </td>
                  <td className="px-2 py-2">{item.decisionReason ?? '—'}</td>
                  <td className="px-2 py-2">{item.remoteIp ?? item.headerSummary ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
