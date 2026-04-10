import type { Floodlight } from '../api/floodlights';

type FloodlightCardProps = {
  floodlight: Floodlight;
  onTurnOn: (id: string) => void;
  onTurnOff: (id: string) => void;
  isMutating: boolean;
};

function StatusBadge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide ${className}`}>
      {label}
    </span>
  );
}

export function FloodlightCard({
  floodlight,
  onTurnOn,
  onTurnOff,
  isMutating,
}: FloodlightCardProps) {
  const isOn = floodlight.lastKnownOutput;
  const isOffline = !floodlight.onlineStatus;

  return (
    <article className="rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">{floodlight.name}</h2>
        <StatusBadge
          label={isOffline ? 'Offline' : 'Online'}
          className={isOffline ? 'bg-red-600/20 text-red-300' : 'bg-emerald-600/20 text-emerald-300'}
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <StatusBadge
          label={isOn ? 'Output: ON' : 'Output: OFF'}
          className={isOn ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-600/40 text-slate-300'}
        />
        <StatusBadge
          label={floodlight.automationEnabled ? 'Automation: Enabled' : 'Automation: Disabled'}
          className={
            floodlight.automationEnabled ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-600/40 text-slate-300'
          }
        />
        {floodlight.testModeEnabled && (
          <StatusBadge label="Test Mode" className="bg-amber-500/20 text-amber-300" />
        )}
        {floodlight.manualOverrideMode && (
          <StatusBadge label="Manual Override" className="bg-amber-500/20 text-amber-300" />
        )}
      </div>

      <div className="mb-4 text-sm text-slate-400">
        <p>Last Seen: {floodlight.lastSeenAt ?? 'Unknown'}</p>
        <p>Last Command: {floodlight.lastCommandStatus ?? 'None'}</p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onTurnOn(floodlight.id)}
          disabled={isMutating}
          className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ON
        </button>
        <button
          type="button"
          onClick={() => onTurnOff(floodlight.id)}
          disabled={isMutating}
          className="flex-1 rounded-md bg-slate-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          OFF
        </button>
      </div>
    </article>
  );
}
