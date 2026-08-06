import type { ExecutionDiagnosticItem } from '../api/diagnostics';

type Props = { records?: ExecutionDiagnosticItem[]; searchText: string; onSearchTextChange: (value: string) => void; isLoading: boolean; isError: boolean; errorMessage?: string; onRefresh: () => void; isRefreshing: boolean };

const words = (value?: string | null) => value ? value.replace(/_/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase()) : '—';
const formatExecutionTime = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
function sourceLabel(record: ExecutionDiagnosticItem) {
  if (record.source === 'semantic_webhook' && record.ingressType === 'timer') return 'Semantic Webhook Timer';
  if (record.source === 'semantic_webhook') return 'Semantic Webhook';
  if (record.source.toLowerCase().includes('protect')) return 'Protect Source';
  return words(record.source);
}
function destination(record: ExecutionDiagnosticItem) {
  const value = record.destinationSummary;
  if (!value) return record.consumerType ? words(record.consumerType) : null;
  const panel = typeof value.panelKey === 'string' ? value.panelKey : null;
  const zone = typeof value.zoneNumber === 'number' ? `Zone ${value.zoneNumber}` : null;
  const state = typeof value.mappedState === 'string' ? value.mappedState : null;
  return [words(record.consumerType), panel && panel !== 'default' ? panel : null, zone, state].filter(Boolean).join(' · ');
}
function resultLabel(record: ExecutionDiagnosticItem) {
  if (!record.accepted) return `Rejected · ${words(record.reason)}`;
  if (record.delivered) return `Delivered · ${words(record.reason)}`;
  if (record.retained) return `Retained · ${words(record.reason)}`;
  if (record.reason === 'state_unchanged' || record.changed === false) return `Unchanged · ${words(record.reason)}`;
  if ((record.failedBindingCount ?? 0) > 0) return `Failed · ${words(record.reason)}`;
  return words(record.reason);
}

export function ExecutionDiagnosticsTable({ records, searchText, onSearchTextChange, isLoading, isError, errorMessage, onRefresh, isRefreshing }: Props) {
  const search = searchText.trim().toLowerCase();
  const visible = (records ?? []).filter((record) => !search || JSON.stringify(record).toLowerCase().includes(search)).slice(0, 200);
  return <section className="min-w-0 rounded-lg border border-slate-700 bg-slate-900/70 p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">Semantic / Output Execution</h2><p className="text-xs text-slate-400">Shared execution results for Protect, Semantic Webhooks, and automatic restores.</p></div><button type="button" onClick={onRefresh} className="rounded border border-slate-600 px-3 py-1 text-sm">{isRefreshing ? 'Refreshing…' : 'Refresh'}</button></div>
    <label className="mb-3 block text-xs text-slate-400">Search execution<input value={searchText} onChange={(event) => onSearchTextChange(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" placeholder="Condition, source, destination, result, or trace ID" /></label>
    {isLoading ? <p className="text-sm text-slate-300">Loading execution diagnostics…</p> : null}
    {isError ? <p className="rounded border border-rose-700 bg-rose-950/40 p-3 text-sm text-rose-200">Failed to load execution diagnostics: {errorMessage ?? 'Unknown error'}</p> : null}
    {!isLoading && !isError && visible.length === 0 ? <p className="text-sm text-slate-300">No semantic execution diagnostics.</p> : null}
    {!isLoading && !isError && visible.length ? <div className="space-y-2">{visible.map((record) => <article key={record.id} className={`rounded border p-3 ${record.timerExpired ? 'border-amber-500/50 bg-amber-950/20' : 'border-slate-700 bg-slate-950/50'}`}>
      <time dateTime={record.createdAt} className="mb-2 block text-sm font-semibold text-slate-200">{formatExecutionTime(record.createdAt)}</time>
      <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold text-sky-100">{sourceLabel(record)}</span><span aria-hidden="true">→</span><span className="font-semibold text-white">{record.semanticConditionLabel ?? `Condition ${record.semanticConditionId}`}</span><span aria-hidden="true">→</span><span>{words(record.requestedState)} / {words(record.lifecycleIntent)}</span>{destination(record) ? <><span aria-hidden="true">→</span><span>{destination(record)}</span></> : null}<span aria-hidden="true">→</span><span className={record.delivered ? 'text-emerald-300' : record.accepted ? 'text-amber-200' : 'text-rose-300'}>{resultLabel(record)}</span></div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400"><span className="rounded bg-slate-800 px-2 py-0.5">{words(record.diagnosticType)}</span><span>Ingress: {words(record.ingressType)}</span>{record.stateOrigin ? <span>Origin: {words(record.stateOrigin)}</span> : null}{record.timerExpired ? <span className="font-semibold text-amber-200">Timer expired</span> : null}{record.autoRestoreSeconds !== null ? <span>Auto restore: {record.autoRestoreSeconds}s</span> : null}{record.consumerBindingId !== null ? <span>Binding #{record.consumerBindingId}</span> : null}</div>
      <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Technical details</summary><div className="mt-1 break-all">Recorded at: {record.createdAt} · Trace ID: {record.traceId} · Sequence: {record.sequence} · Source event: {record.sourceEventType ?? record.sourceEventClass}</div></details>
    </article>)}</div> : null}
  </section>;
}
