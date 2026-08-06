import type { VirtualSecurityPanelServiceStatus } from '../api/diagnostics';
import { StatusBadge } from './PlatformUi';

type Tone = 'good' | 'warn' | 'bad' | 'neutral';
export function interpretVirtualSecurityPanelStatus(status: VirtualSecurityPanelServiceStatus): { label: string; tone: Tone } {
  if (status.listenerState === 'error') return { label: 'Fault', tone: 'bad' };
  if (!status.enabled && status.listenerState === 'disabled') return { label: 'Disabled', tone: 'neutral' };
  if (status.listenerState === 'starting') return { label: 'Starting', tone: 'warn' };
  if (status.enabled && status.listenerState === 'stopped') return { label: 'Stopped', tone: 'warn' };
  if (status.listenerState === 'listening' && !status.savantClientConnected) return { label: 'Listening — Savant disconnected', tone: 'warn' };
  if (status.enabled && status.listenerState === 'listening' && status.savantClientConnected) return { label: 'Healthy', tone: 'good' };
  return { label: 'Stopped', tone: 'warn' };
}

const formatTime = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : 'Not recorded since startup';
const errorLabels: Record<NonNullable<VirtualSecurityPanelServiceStatus['lastTransportError']>['code'], string> = {
  listener_bind_failed: 'Listener bind failed',
  client_socket_error: 'Savant client socket error',
  transport_send_failed: 'Transport send failed',
};

export function VirtualSecurityPanelStatusCard({ status, isLoading, isError, isFetching = false, onRefresh, detail = 'compact', title = true }: {
  status?: VirtualSecurityPanelServiceStatus;
  isLoading: boolean;
  isError: boolean;
  isFetching?: boolean;
  onRefresh?: () => void;
  detail?: 'compact' | 'full';
  title?: boolean;
}) {
  if (isLoading && !status) return <section className="rounded border border-slate-700 bg-slate-900/70 p-3"><p className="text-sm text-slate-300">Loading Virtual Security Panel status…</p></section>;
  if (isError && !status) return <section className="rounded border border-rose-700/50 bg-rose-950/20 p-3"><p className="text-sm text-rose-200">Virtual Security Panel status is temporarily unavailable.</p>{onRefresh ? <button type="button" onClick={onRefresh} className="mt-2 rounded border border-slate-600 px-2 py-1 text-xs">Retry</button> : null}</section>;
  if (!status) return null;
  const interpretation = interpretVirtualSecurityPanelStatus(status);
  return <section className="min-w-0 rounded border border-slate-700 bg-slate-900/70 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div>{title ? <h3 className="font-semibold text-white">Virtual Security Panel</h3> : null}<StatusBadge tone={interpretation.tone}>{interpretation.label}</StatusBadge></div>{onRefresh ? <button type="button" onClick={onRefresh} className="rounded border border-slate-600 px-2 py-1 text-xs">{isFetching ? 'Refreshing…' : 'Refresh'}</button> : null}</div>
    {isError ? <p className="mt-2 text-xs text-amber-200">Refresh failed; showing the last available status.</p> : null}
    <dl className={`mt-3 grid gap-2 text-sm ${detail === 'full' ? 'sm:grid-cols-2 xl:grid-cols-3' : 'grid-cols-2'}`}>
      <div><dt className="text-xs text-slate-500">Feature</dt><dd>{status.enabled ? 'Enabled' : 'Disabled'}</dd></div>
      <div><dt className="text-xs text-slate-500">Listener</dt><dd className="capitalize">{status.listenerState}</dd></div>
      <div><dt className="text-xs text-slate-500">Savant Client</dt><dd>{status.savantClientConnected ? 'Connected' : 'Disconnected'}</dd></div>
      <div><dt className="text-xs text-slate-500">Listen Address</dt><dd className="break-all font-mono text-xs">{status.listenHost}:{status.listenPort}</dd></div>
      <div><dt className="text-xs text-slate-500">Configured Zones</dt><dd>{status.configuredZoneCount}</dd></div>
      <div><dt className="text-xs text-slate-500">Retained Zones</dt><dd>{status.retainedZoneCount}</dd></div>
      {detail === 'full' ? <><div><dt className="text-xs text-slate-500">Last Connected</dt><dd>{formatTime(status.lastClientConnectedAt)}</dd></div><div><dt className="text-xs text-slate-500">Last Disconnected</dt><dd>{formatTime(status.lastClientDisconnectedAt)}</dd></div><div><dt className="text-xs text-slate-500">Last Transport Error</dt><dd>{status.lastTransportError ? `${errorLabels[status.lastTransportError.code]} at ${formatTime(status.lastTransportError.timestamp)}` : 'No transport error recorded'}</dd></div></> : null}
    </dl>
    {status.listenerState === 'error' ? <p className="mt-3 rounded border border-rose-700/50 bg-rose-950/30 p-2 text-xs text-rose-200">{status.lastTransportError?.message ?? 'The Virtual Security Panel listener encountered a fault.'}</p> : null}
    {status.listenerState === 'listening' && !status.savantClientConnected ? <p className="mt-3 text-xs text-amber-200">Virtual Security Panel is listening, but no Savant client is connected.</p> : null}
    {!status.enabled && status.configuredZoneCount > 0 ? <p className="mt-3 text-xs text-amber-200">Outputs are configured, but the Virtual Security Panel service is disabled.</p> : null}
    {detail === 'full' && status.lastTransportError ? <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Advanced error details</summary><p className="mt-1">Code: {status.lastTransportError.code} · Timestamp: {status.lastTransportError.timestamp}</p><p>{status.lastTransportError.message}</p></details> : null}
  </section>;
}
