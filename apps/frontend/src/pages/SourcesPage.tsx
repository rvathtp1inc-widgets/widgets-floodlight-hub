import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useEventRoutes, useProtectSources } from '../hooks/useEventRoutes';
import { useAccessDoors, useAccessStatus, useConditions, useSemanticWebhookMutations, useSemanticWebhooks } from '../hooks/usePlatform';
import { useSyncProtectSources } from '../hooks/useSettings';
import { ActionNotice, StatusBadge, UnavailableState } from '../components/PlatformUi';
import { SemanticWebhookCard } from '../components/SemanticWebhookCard';
import { apiErrorMessage } from '../utils/apiErrors';

type Notice = { type: 'success' | 'error'; text: string };

export function SourcesPage() {
  const sources = useProtectSources(); const routes = useEventRoutes(); const access = useAccessStatus(); const doors = useAccessDoors(); const sync = useSyncProtectSources();
  const conditions = useConditions(); const semanticWebhooks = useSemanticWebhooks(); const mutations = useSemanticWebhookMutations();
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState('all'); const [notice, setNotice] = useState<Notice | null>(null);
  const [semanticConditionId, setSemanticConditionId] = useState(searchParams.get('semanticConditionId') ?? ''); const [displayName, setDisplayName] = useState(''); const [webhookKey, setWebhookKey] = useState(''); const [sharedSecret, setSharedSecret] = useState('');
  const [restoreMode, setRestoreMode] = useState<'explicit_inactive' | 'auto_timeout'>('explicit_inactive'); const [autoRestoreSeconds, setAutoRestoreSeconds] = useState('30'); const [timeoutError, setTimeoutError] = useState<string | null>(null);
  const used = useMemo(() => new Set((routes.data ?? []).map((route) => route.sourceId)), [routes.data]);
  const filtered = (sources.data ?? []).filter((source) => filter === 'all' || (filter === 'connected' ? source.state.toLowerCase().includes('connect') : filter === 'used' ? used.has(source.id) : filter === 'unused' ? !used.has(source.id) : filter === 'cameras'));

  async function createWebhook(event: FormEvent) {
    event.preventDefault();
    const seconds = Number(autoRestoreSeconds);
    if (restoreMode === 'auto_timeout' && (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400)) {
      setTimeoutError('Enter a whole number from 1 through 86,400.');
      return;
    }
    setTimeoutError(null);
    const payload = {
      semanticConditionId: Number(semanticConditionId), displayName: displayName.trim() || undefined,
      webhookKey: webhookKey.trim(), sharedSecret: sharedSecret.trim() || undefined, enabled: true,
      restoreMode, autoRestoreSeconds: restoreMode === 'auto_timeout' ? seconds : null,
    } as const;
    try {
      await mutations.create.mutateAsync(payload);
      setWebhookKey(''); setDisplayName(''); setSharedSecret(''); setRestoreMode('explicit_inactive'); setAutoRestoreSeconds('30');
      setNotice({ type: 'success', text: 'Semantic Webhook created.' });
    } catch (error) { setNotice({ type: 'error', text: apiErrorMessage(error) }); }
  }

  return <section className="space-y-4">
    <header><h1 className="text-2xl font-bold text-white">Sources</h1><p className="text-sm text-slate-400">Discovered systems and inventory that can initiate Automation.</p></header><ActionNotice notice={notice} />
    <section className="rounded border border-slate-800 bg-slate-900/70 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">UniFi Protect · Protect Sources</h2><p className="text-sm text-slate-400">Current inventory endpoint exposes camera-oriented Protect sources. Sensor REST inventory and live-event contracts are not validated.</p></div><button onClick={async () => { try { const value = await sync.mutateAsync(); setNotice({ type: 'success', text: `Protect Sources synced${typeof value.totalKnownSources === 'number' ? `: ${value.totalKnownSources} known` : ''}.` }); } catch (error) { setNotice({ type: 'error', text: apiErrorMessage(error) }); } }} className="rounded bg-blue-600 px-3 py-2 text-sm text-white">Sync Protect Sources</button></div>
      <div className="my-3 flex flex-wrap gap-2">{['all','cameras','connected','used','unused'].map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded px-2 py-1 text-xs capitalize ${filter === item ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-300'}`}>{item}</button>)}</div>
      <div className="grid gap-3 md:grid-cols-2">{filtered.map((source) => <article key={source.id} className="rounded border border-slate-700 bg-slate-950/50 p-3"><div className="flex justify-between gap-2"><div><h3 className="font-semibold text-white">{source.name}</h3><p className="text-xs text-slate-500">Camera · {source.modelKey}</p></div><StatusBadge tone={source.state.toLowerCase().includes('connect') ? 'good' : 'warn'}>{source.state}</StatusBadge></div><p className="mt-2 text-sm">{used.has(source.id) ? 'Configured in Automation' : 'Discovered · Unused'}</p><p className="text-xs text-slate-500">Capabilities: {source.supportedObjectTypes.length ? source.supportedObjectTypes.join(', ') : source.supportsSmartDetect ? 'Smart Detect' : 'Motion'}</p><p className="text-xs text-slate-500">Last seen: {source.lastSeenAt ? new Date(source.lastSeenAt).toLocaleString() : 'Unavailable'} · Last event: {source.lastEventSeenAt ? new Date(source.lastEventSeenAt).toLocaleString() : 'None recorded'}</p>{!used.has(source.id) ? <p className="mt-2 text-xs text-amber-200">This Protect Source is discovered but is not used by any Automation.</p> : null}</article>)}</div>
      {(sources.data?.length ?? 0) === 0 && !sources.isLoading ? <UnavailableState>No Protect Sources discovered. Configure credentials in Settings, then sync.</UnavailableState> : null}
      <p className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">Protect Sensors: Event capture required. Live-event Automation controls remain unavailable.</p>
    </section>
    <section className="rounded border border-slate-800 bg-slate-900/70 p-4"><div className="flex justify-between"><h2 className="text-lg font-semibold text-white">UniFi Access</h2><StatusBadge tone={access.data?.backgroundPollingRunning ? 'good' : access.data?.enabled ? 'warn' : 'neutral'}>{access.data?.backgroundPollingRunning ? 'Polling' : access.data?.enabled ? 'Enabled / not polling' : 'Disabled'}</StatusBadge></div><p className="text-sm text-slate-400">Discovered doors: {doors.data?.length ?? 0}. Access route creation is not supported by the current event-route API.</p>{access.data?.lastPollError ? <p className="text-sm text-rose-200">Last poll error: {access.data.lastPollError}</p> : null}</section>
    <section id="semantic-webhooks" className="rounded border border-slate-800 bg-slate-900/70 p-4"><h2 className="text-lg font-semibold text-white">Semantic Webhooks</h2><p className="text-sm text-slate-400">External systems set a Condition Active or Inactive. Configured Outputs respond through the shared Condition execution path.</p>
      <form className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" onSubmit={createWebhook}>
        <label className="text-xs text-slate-300">Condition<select required value={semanticConditionId} onChange={(event) => setSemanticConditionId(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-sm"><option value="">Select condition</option>{(conditions.data ?? []).filter((condition) => !(semanticWebhooks.data ?? []).some((webhook) => webhook.semanticConditionId === condition.id)).map((condition) => <option key={condition.id} value={condition.id}>{condition.label}</option>)}</select></label>
        <label className="text-xs text-slate-300">Display name <span className="text-slate-500">(optional)</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-sm" /></label>
        <label className="text-xs text-slate-300">Webhook key<input required value={webhookKey} onChange={(event) => setWebhookKey(event.target.value)} placeholder="front-yard-person" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-sm" /></label>
        <label className="text-xs text-slate-300">Shared secret<input type="password" value={sharedSecret} onChange={(event) => setSharedSecret(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-sm" /></label>
        <label className="text-xs text-slate-300">Restore behavior<select value={restoreMode} onChange={(event) => { const mode = event.target.value as typeof restoreMode; setRestoreMode(mode); if (mode === 'auto_timeout' && !autoRestoreSeconds) setAutoRestoreSeconds('30'); setTimeoutError(null); }} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-sm"><option value="explicit_inactive">Explicit Inactive</option><option value="auto_timeout">Auto Restore</option></select></label>
        {restoreMode === 'auto_timeout' ? <label className="text-xs text-slate-300">Auto-restore seconds<input type="number" min="1" max="86400" step="1" required value={autoRestoreSeconds} onChange={(event) => setAutoRestoreSeconds(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-sm" />{timeoutError ? <span className="mt-1 block text-rose-300">{timeoutError}</span> : null}</label> : <div className="self-end text-xs text-slate-400">The installer will call the Inactive URL explicitly.</div>}
        <button className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white sm:col-span-2 xl:col-span-3">Create Semantic Webhook</button>
      </form>
      <div className="mt-4 space-y-3">{(semanticWebhooks.data ?? []).map((webhook) => <SemanticWebhookCard key={webhook.id} webhook={webhook} onNotice={setNotice} onUpdate={async (input) => { try { return await mutations.update.mutateAsync({ id: webhook.id, input }); } catch (error) { throw new Error(apiErrorMessage(error)); } }} onDelete={() => mutations.remove.mutateAsync(webhook.id)} />)}</div>
      {(semanticWebhooks.data?.length ?? 0) === 0 && !semanticWebhooks.isLoading ? <UnavailableState>No Semantic Webhooks configured.</UnavailableState> : null}
    </section>
  </section>;
}
