import type { HubSettings } from '../api/settings';

type HubInfoCardProps = {
  settings: HubSettings;
};

export function HubInfoCard({ settings }: HubInfoCardProps) {
  return (
    <section className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-4">
      <h2 className="text-lg font-semibold text-white">Hub Information</h2>
      <p className="mt-1 text-sm text-slate-400">Read-only values currently provided by the hub settings endpoint.</p>

      <dl className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Hub settings record</dt>
          <dd className="text-sm text-slate-100">#{settings.id}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">UI Session Timeout</dt>
          <dd className="text-sm text-slate-100">{settings.uiSessionTimeoutMinutes} minutes</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Log Retention</dt>
          <dd className="text-sm text-slate-100">{settings.logRetentionDays} days</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Last Updated</dt>
          <dd className="text-sm text-slate-100">{new Date(settings.updatedAt).toLocaleString()}</dd>
        </div>
      </dl>

      {/* TODO: Expose editable controls for session timeout and log retention when product requirements request them. */}
    </section>
  );
}
