import { useMemo, useState } from 'react';
import type { EventLogItem } from '../api/diagnostics';

type EventFilter = 'all' | 'floodlight' | 'group' | 'accepted' | 'rejected';

type EventLogTableProps = {
  events?: EventLogItem[];
  searchText: string;
  onSearchTextChange: (value: string) => void;
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

function eventStageLabel(item: EventLogItem) {
  const method = item.httpMethod ?? '—';
  if (method === 'POST') {
    return 'POST / WEBHOOK_RECEIVED';
  }
  if (method === 'ROUTE_WEBHOOK') {
    return 'ROUTE_WEBHOOK / EXECUTION';
  }
  return method;
}

function resultPill(item: EventLogItem) {
  const normalized = (item.decision ?? '').toLowerCase();
  const method = item.httpMethod ?? '';
  const reason = item.decisionReason ?? '';
  if (method === 'POST' && normalized.includes('accept') && reason === 'ingress_received_normalized') {
    return (
      <span className="inline-flex rounded border border-sky-600/40 bg-sky-900/50 px-2 py-0.5 text-xs font-semibold text-sky-200">
        ingress accepted
      </span>
    );
  }
  if (normalized.includes('accept')) {
    return <span className="inline-flex rounded border border-emerald-600/40 bg-emerald-900/50 px-2 py-0.5 text-xs font-semibold text-emerald-200">accepted</span>;
  }
  if (normalized.includes('reject')) {
    return <span className="inline-flex rounded border border-red-600/40 bg-red-900/50 px-2 py-0.5 text-xs font-semibold text-red-200">rejected</span>;
  }
  return <span>{item.decision ?? '—'}</span>;
}

function routeIdFromHeaderSummary(headerSummary?: string | null) {
  if (!headerSummary) return null;

  try {
    const parsed = JSON.parse(headerSummary) as { routeId?: unknown };
    return typeof parsed.routeId === 'number' ? parsed.routeId : null;
  } catch {
    return null;
  }
}

function routeIngressLabel(item: EventLogItem) {
  const routeId = routeIdFromHeaderSummary(item.headerSummary);
  if (routeId !== null) return `route:${routeId}`;
  if (item.webhookKey?.startsWith('route:')) return item.webhookKey;
  return item.webhookKey ?? '—';
}

export function EventLogTable({
  events,
  searchText,
  onSearchTextChange,
  isLoading,
  isError,
  errorMessage,
  onRefresh,
  isRefreshing,
}: EventLogTableProps) {
  const [filter, setFilter] = useState<EventFilter>('all');

  const normalizedSearch = searchText.trim().toLowerCase();

  const visibleEvents = useMemo(() => {
    const sorted = [...(events ?? [])].sort((a, b) => b.id - a.id).slice(0, 100);

    return sorted.filter((item) => {
      if (filter === 'floodlight' || filter === 'group') {
        if (item.targetType !== filter) return false;
      }
      if (filter === 'accepted') {
        if (!(item.decision ?? '').toLowerCase().includes('accept')) return false;
      }
      if (filter === 'rejected') {
        if (!(item.decision ?? '').toLowerCase().includes('reject')) return false;
      }

      if (!normalizedSearch) return true;
      const haystack = [
        item.targetName,
        item.targetType,
        item.targetId ? `#${item.targetId}` : null,
        routeIngressLabel(item),
        item.webhookKey,
        item.remoteIp,
        item.decisionReason,
        item.authResult,
        item.decision,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(normalizedSearch)) return false;
      return true;
    });
  }, [events, filter, normalizedSearch]);

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Event Log</h2>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={searchText}
            onChange={(event) => onSearchTextChange(event.target.value)}
            placeholder="Filter by name, webhook, source, or reason"
            className="w-72 max-w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-400"
          />
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
                <th className="px-2 py-2">Route / Ingress</th>
                <th className="px-2 py-2">Result</th>
                <th className="px-2 py-2">Reason</th>
                <th className="px-2 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map((item) => (
                <tr key={item.id} className="border-t border-slate-800">
                  <td className="px-2 py-2 whitespace-nowrap">{toDate(item.receivedAt ?? item.createdAt)}</td>
                  <td className="px-2 py-2">{eventStageLabel(item)}</td>
                  <td className="px-2 py-2">
                    {item.targetName ?? item.targetType ?? 'unknown'}
                    {item.targetId ? <span className="ml-1 text-xs text-slate-400">(#{item.targetId})</span> : null}
                  </td>
                  <td className="px-2 py-2">{routeIngressLabel(item)}</td>
                  <td className="px-2 py-2">
                    {resultPill(item)}
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
