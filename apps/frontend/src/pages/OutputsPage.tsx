import { useState, type FormEvent } from 'react';
import type { AxiosError } from 'axios';
import { ActionNotice, StatusBadge, UnavailableState } from '../components/PlatformUi';
import { useBindingMutations, useConditions, useConsumerBindings } from '../hooks/usePlatform';
import { useVirtualSecurityPanelStatus } from '../hooks/useDiagnostics';
import { VirtualSecurityPanelStatusCard } from '../components/VirtualSecurityPanelStatusCard';

const errorText = (error: unknown) => (error as AxiosError<{ error?: string }>).response?.data?.error ?? (error instanceof Error ? error.message : 'Unknown error');

export function OutputsPage() {
  const conditions = useConditions(); const bindings = useConsumerBindings(); const mutations = useBindingMutations();
  const vspStatus = useVirtualSecurityPanelStatus();
  const [conditionId, setConditionId] = useState(''); const [zone, setZone] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const names = new Map((conditions.data ?? []).map((item) => [item.id, item.label]));
  async function submit(event: FormEvent) { event.preventDefault(); const zoneNumber = Number(zone); if (!Number.isInteger(zoneNumber) || zoneNumber < 1 || zoneNumber > 208) { setNotice({ type: 'error', text: 'Savant Zone Number must be an integer from 1 through 208.' }); return; } try { await mutations.create.mutateAsync({ semanticConditionId: Number(conditionId), consumerType: 'virtual_security_panel', binding: { panelKey: 'default', zoneNumber }, enabled: true }); setZone(''); setNotice({ type: 'success', text: 'Virtual Security Panel Output created.' }); } catch (error) { setNotice({ type: 'error', text: errorText(error) }); } }
  return <section className="space-y-4">
    <header><h1 className="text-2xl font-bold text-white">Outputs</h1><p className="text-sm text-slate-400">Connect Conditions to configured output services. No output type is required for local Hub operation.</p></header>
    <ActionNotice notice={notice} />
    <section className="rounded border border-slate-800 bg-slate-900/70 p-4">
      <div><h2 className="text-lg font-semibold text-white">Virtual Security Panel</h2><p className="text-sm text-slate-400">Active Condition → Violated zone · Inactive Condition → Normal zone</p></div>
      <div className="mt-3"><VirtualSecurityPanelStatusCard title={false} status={vspStatus.data} isLoading={vspStatus.isLoading} isError={vspStatus.isError} isFetching={vspStatus.isFetching} /></div>
      {vspStatus.data?.enabled && vspStatus.data.listenerState === 'listening' && !vspStatus.data.savantClientConnected ? <p className="mt-2 text-xs text-sky-200">State changes will be retained for synchronization when Savant reconnects.</p> : null}
      <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr_auto]">
        <label className="text-sm text-slate-300">Condition<select required value={conditionId} onChange={(e) => setConditionId(e.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="">Select Condition</option>{(conditions.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="text-sm text-slate-300">Savant Zone Number<input required type="number" min={1} max={208} step={1} value={zone} onChange={(e) => setZone(e.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
        <button disabled={!conditionId || mutations.create.isPending} className="self-end rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-700">Add Output</button>
      </form>
    </section>
    <div className="space-y-3">{(bindings.data ?? []).map((binding) => <article key={binding.id} className="rounded border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-base text-white"><strong>{names.get(binding.semanticConditionId) ?? 'Missing Condition'}</strong><span className="mx-2 text-slate-500">→</span>Virtual Security Panel<span className="mx-2 text-slate-500">→</span>Savant Zone {binding.binding.zoneNumber}</p><StatusBadge tone={binding.enabled ? 'good' : 'warn'}>{binding.enabled ? 'Enabled' : 'Disabled'}</StatusBadge></div>
      {!names.has(binding.semanticConditionId) ? <p className="mt-2 text-sm text-rose-200">This Output references a missing Condition.</p> : null}
      <div className="mt-3 flex gap-2"><button onClick={() => void mutations.update.mutateAsync({ id: binding.id, input: { enabled: !binding.enabled } })} className="rounded border border-slate-600 px-3 py-1.5 text-xs">{binding.enabled ? 'Disable' : 'Enable'}</button><button onClick={async () => { try { await mutations.remove.mutateAsync(binding.id); setNotice({ type: 'success', text: 'Output deleted.' }); } catch (error) { setNotice({ type: 'error', text: errorText(error) }); } }} className="rounded border border-rose-500/50 px-3 py-1.5 text-xs text-rose-200">Delete</button></div>
      <details className="mt-3 text-xs text-slate-500"><summary>Advanced / Debug</summary><p>Consumer type: {binding.consumerType} · Panel key: {binding.binding.panelKey} · Binding ID: {binding.id}</p></details>
    </article>)}</div>
    {(bindings.data?.length ?? 0) === 0 && !bindings.isLoading ? <UnavailableState>No Condition Outputs are configured.</UnavailableState> : null}
  </section>;
}
