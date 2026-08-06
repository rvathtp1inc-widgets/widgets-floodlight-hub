import { useMemo, useState, type FormEvent } from 'react';
import type { AxiosError } from 'axios';
import { Link } from 'react-router-dom';
import { useEventRoutes } from '../hooks/useEventRoutes';
import { useConditionMutations, useConditions, useConsumerBindings, useSemanticWebhookMutations, useSemanticWebhooks } from '../hooks/usePlatform';
import { ActionNotice, StatusBadge, UnavailableState } from '../components/PlatformUi';
import { SemanticWebhookCard } from '../components/SemanticWebhookCard';
import { apiErrorMessage } from '../utils/apiErrors';

const errorText = (error: unknown) => (error as AxiosError<{ error?: string }>).response?.data?.error ?? (error instanceof Error ? error.message : 'Unknown error');

export function ConditionsPage() {
  const conditions = useConditions(); const bindings = useConsumerBindings(); const routes = useEventRoutes(); const webhooks = useSemanticWebhooks(); const webhookMutations = useSemanticWebhookMutations();
  const actions = useMemo(() => ({ routes: routes.data ?? [], bindings: bindings.data ?? [] }), [routes.data, bindings.data]);
  const conditionActions = useConditionMutations();
  const [label, setLabel] = useState(''); const [semanticKey, setSemanticKey] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  async function submit(event: FormEvent) { event.preventDefault(); try { await conditionActions.create.mutateAsync({ label: label.trim(), semanticKey: semanticKey.trim(), enabled: true, restorePolicy: 'source_lifecycle' }); setLabel(''); setSemanticKey(''); setNotice({ type: 'success', text: 'Condition created.' }); } catch (error) { setNotice({ type: 'error', text: errorText(error) }); } }
  return <section className="space-y-4">
    <header><h1 className="text-2xl font-bold text-white">Conditions</h1><p className="text-sm text-slate-400">Meaningful states set by Automation and consumed by Outputs.</p></header>
    <ActionNotice notice={notice} />
    <form onSubmit={submit} className="grid gap-3 rounded border border-slate-800 bg-slate-900/70 p-4 md:grid-cols-[2fr_2fr_auto]">
      <label className="text-sm text-slate-300">Label<input required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Front Yard Person" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
      <label className="text-sm text-slate-300">Semantic Key <span className="text-xs text-slate-500">(stable after creation)</span><input required pattern="[a-z0-9]+([._-][a-z0-9]+)*" value={semanticKey} onChange={(e) => setSemanticKey(e.target.value)} placeholder="protect.frontyard.person" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white" /></label>
      <button className="self-end rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Create Condition</button>
    </form>
    {conditions.isLoading ? <p>Loading Conditions…</p> : null}
    <div className="grid gap-3 lg:grid-cols-2">{(conditions.data ?? []).map((condition) => {
      const incoming = actions.routes.filter((route) => route.targetType === 'semantic_condition' && route.targetId === condition.id);
      const outputs = actions.bindings.filter((binding) => binding.semanticConditionId === condition.id);
      const webhook = (webhooks.data ?? []).find((item) => item.semanticConditionId === condition.id);
      const conflictingRoute = incoming.some((route) => route.enabled && route.bindingStatus === 'resolved');
      return <article key={condition.id} className="rounded border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">{condition.label}</h2><p className="font-mono text-xs text-slate-500">{condition.semanticKey}</p></div><StatusBadge tone={condition.enabled ? 'good' : 'warn'}>{condition.enabled ? 'Enabled' : 'Disabled'}</StatusBadge></div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-slate-500">Restore Policy</dt><dd>Source Lifecycle</dd></div><div><dt className="text-slate-500">Runtime State</dt><dd>Unavailable</dd></div><div><dt className="text-slate-500">Incoming Automations</dt><dd>{incoming.length}</dd></div><div><dt className="text-slate-500">Configured Outputs</dt><dd>{outputs.length}</dd></div></dl>
        {incoming.length === 0 ? <p className="mt-3 text-sm text-amber-200">This Condition has no incoming Automation.</p> : null}
        {!outputs.some((item) => item.enabled) ? <p className="mt-2 text-sm text-amber-200">This Condition has no enabled Output.</p> : null}
        <section className="mt-3 border-t border-slate-700 pt-3"><h3 className="mb-2 text-sm font-semibold text-white">Semantic Webhook → Condition → Outputs</h3>{webhook ? <SemanticWebhookCard compact webhook={webhook} onNotice={setNotice} onUpdate={async (input) => { try { return await webhookMutations.update.mutateAsync({ id: webhook.id, input }); } catch (error) { throw new Error(apiErrorMessage(error)); } }} onDelete={() => webhookMutations.remove.mutateAsync(webhook.id)} /> : <div className="rounded border border-slate-700 bg-slate-950/50 p-3"><p className="text-sm text-slate-300">No Semantic Webhook configured.</p>{conflictingRoute ? <p className="mt-1 text-xs text-amber-200">This Condition is already controlled by an enabled Automation. Disable or retarget it before enabling a Semantic Webhook.</p> : null}<Link to={`/sources?semanticConditionId=${condition.id}#semantic-webhooks`} className="mt-2 inline-block rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">Add Semantic Webhook</Link></div>}</section>
        <div className="mt-3 flex gap-2"><button onClick={() => void conditionActions.update.mutateAsync({ id: condition.id, input: { enabled: !condition.enabled } })} className="rounded border border-slate-600 px-3 py-1.5 text-xs">{condition.enabled ? 'Disable' : 'Enable'}</button><button onClick={async () => { try { await conditionActions.remove.mutateAsync(condition.id); setNotice({ type: 'success', text: 'Condition deleted.' }); } catch (error) { setNotice({ type: 'error', text: errorText(error) }); } }} className="rounded border border-rose-500/50 px-3 py-1.5 text-xs text-rose-200">Delete</button></div>
      </article>;
    })}</div>
    {(conditions.data?.length ?? 0) === 0 && !conditions.isLoading ? <UnavailableState>No Conditions configured. Create one before adding semantic Automation or Outputs.</UnavailableState> : null}
  </section>;
}
