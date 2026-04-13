import type { HealthResponse } from '../api/diagnostics';

type HealthSummaryProps = {
  health?: HealthResponse;
  recentEventsCount: number;
  recentCommandFailuresCount: number;
  activeTimersCount: number;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRefresh: () => void;
  isRefreshing: boolean;
};

function statusBadge(value: string | undefined) {
  if (!value) return 'bg-slate-800 text-slate-200 border-slate-600';
  if (['up', 'ok', 'running'].includes(value)) {
    return 'bg-emerald-900/50 text-emerald-200 border-emerald-600/50';
  }
  return 'bg-amber-900/50 text-amber-200 border-amber-600/50';
}

export function HealthSummary({
  health,
  recentEventsCount,
  recentCommandFailuresCount,
  activeTimersCount,
  isLoading,
  isError,
  errorMessage,
  onRefresh,
  isRefreshing,
}: HealthSummaryProps) {
  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Health Summary</h2>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-100 hover:bg-slate-800"
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {isLoading && <p className="text-sm text-slate-300">Loading health data...</p>}

      {isError && (
        <p className="rounded-md border border-red-700/40 bg-red-950/40 p-3 text-sm text-red-200">
          Failed to load health summary: {errorMessage ?? 'Unknown error'}
        </p>
      )}

      {!isLoading && !isError && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {health?.app && (
            <div className="rounded-md border border-slate-700 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">API</p>
              <span className={`mt-1 inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${statusBadge(health.app)}`}>
                {health.app}
              </span>
            </div>
          )}

          {health?.db && (
            <div className="rounded-md border border-slate-700 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Database</p>
              <span className={`mt-1 inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${statusBadge(health.db)}`}>
                {health.db}
              </span>
            </div>
          )}

          {health?.timerService && (
            <div className="rounded-md border border-slate-700 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Timer Service</p>
              <span className={`mt-1 inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${statusBadge(health.timerService)}`}>
                {health.timerService}
              </span>
            </div>
          )}

          {health?.counts && (
            <div className="rounded-md border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-wide text-slate-400">Configured</p>
              <p>Floodlights: {health.counts.floodlights ?? 'n/a'}</p>
              <p>Groups: {health.counts.groups ?? 'n/a'}</p>
            </div>
          )}

          <div className="rounded-md border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-200">
            <p className="text-xs uppercase tracking-wide text-slate-400">Recent Events</p>
            <p className="text-lg font-semibold text-white">{recentEventsCount}</p>
          </div>

          <div className="rounded-md border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-200">
            <p className="text-xs uppercase tracking-wide text-slate-400">Command Failures</p>
            <p className="text-lg font-semibold text-white">{recentCommandFailuresCount}</p>
          </div>

          <div className="rounded-md border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-200">
            <p className="text-xs uppercase tracking-wide text-slate-400">Active Timers</p>
            <p className="text-lg font-semibold text-white">{activeTimersCount}</p>
          </div>
        </div>
      )}
    </section>
  );
}
