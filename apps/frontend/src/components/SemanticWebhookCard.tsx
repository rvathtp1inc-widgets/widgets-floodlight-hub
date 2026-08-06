import { useState, type FormEvent } from 'react';
import type { SemanticWebhook, SemanticWebhookUpdateInput } from '../api/platform';
import { StatusBadge } from './PlatformUi';
import { copyText } from '../utils/clipboard';

type Notice = { type: 'success' | 'error'; text: string };

export function restoreBehaviorLabel(webhook: Pick<SemanticWebhook, 'restoreMode' | 'autoRestoreSeconds'>) {
  return webhook.restoreMode === 'auto_timeout'
    ? `Auto Restore · ${webhook.autoRestoreSeconds ?? 'invalid'} seconds`
    : 'Explicit Inactive';
}

export function SemanticWebhookCard({
  webhook,
  onUpdate,
  onDelete,
  onNotice,
  compact = false,
}: {
  webhook: SemanticWebhook;
  onUpdate: (input: SemanticWebhookUpdateInput) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onNotice: (notice: Notice) => void;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(webhook.displayName);
  const [restoreMode, setRestoreMode] = useState(webhook.restoreMode);
  const [autoRestoreSeconds, setAutoRestoreSeconds] = useState(webhook.autoRestoreSeconds === null ? '30' : String(webhook.autoRestoreSeconds));
  const [sharedSecret, setSharedSecret] = useState('');
  const [timeoutError, setTimeoutError] = useState<string | null>(null);
  const activeUrl = `${window.location.origin}${webhook.activePath}`;
  const inactiveUrl = `${window.location.origin}${webhook.inactivePath}`;

  async function copy(value: string, label: string) {
    const success = await copyText(value);
    onNotice({ type: success ? 'success' : 'error', text: success ? `${label} copied.` : `Could not copy ${label.toLowerCase()}.` });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const seconds = Number(autoRestoreSeconds);
    if (restoreMode === 'auto_timeout' && (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400)) {
      setTimeoutError('Enter a whole number from 1 through 86,400.');
      return;
    }
    setTimeoutError(null);
    const input: SemanticWebhookUpdateInput = {
      displayName: displayName.trim(),
      restoreMode,
      autoRestoreSeconds: restoreMode === 'auto_timeout' ? seconds : null,
    };
    if (sharedSecret.trim()) input.sharedSecret = sharedSecret.trim();
    try {
      await onUpdate(input);
      setSharedSecret('');
      setEditing(false);
      onNotice({ type: 'success', text: 'Semantic Webhook updated.' });
    } catch (error) {
      onNotice({ type: 'error', text: error instanceof Error ? error.message : 'Update failed.' });
    }
  }

  return <article className="rounded border border-slate-700 bg-slate-950/50 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="font-semibold text-white">{webhook.displayName}</h3><p className="text-xs text-slate-400">{webhook.semanticConditionLabel} · Key: <span className="font-mono">{webhook.webhookKey}</span></p></div>
      <StatusBadge tone={webhook.enabled ? 'good' : 'neutral'}>{webhook.enabled ? 'Enabled' : 'Disabled'}</StatusBadge>
    </div>
    <div className="mt-3 rounded border border-slate-700 bg-slate-900/70 p-3">
      <p className="font-semibold text-sky-100">{restoreBehaviorLabel(webhook)}</p>
      {webhook.restoreMode === 'auto_timeout' ? <div className="mt-1 space-y-1 text-xs text-slate-400"><p>Each valid Active webhook resets the full duration. The Condition automatically becomes Inactive when the timer expires.</p><p>The Inactive URL remains valid and cancels the timer immediately. Pending automatic-restore timers are cleared when the Hub restarts.</p></div> : <p className="mt-1 text-xs text-slate-400">The source sends Active and Inactive explicitly.</p>}
    </div>
    <p className="mt-2 text-xs text-slate-400">Shared secret: {webhook.hasSharedSecret ? 'configured' : 'not configured'} · {webhook.authenticationHeaderDescription}</p>
    <div className="mt-3 flex flex-wrap gap-2 text-xs">
      <button type="button" className="rounded border border-slate-600 px-2 py-1" onClick={() => void copy(activeUrl, 'Active URL')}>Copy Active URL</button>
      <button type="button" className="rounded border border-slate-600 px-2 py-1" onClick={() => void copy(inactiveUrl, 'Inactive URL')}>Copy Inactive URL</button>
      <button type="button" className="rounded border border-slate-600 px-2 py-1" onClick={() => void copy(webhook.authenticationHeaderName, 'Authentication header')}>Copy Header</button>
      {!compact ? <><button type="button" className="rounded border border-slate-600 px-2 py-1" onClick={() => void copy(`curl -X POST -H '${webhook.authenticationHeaderName}: <your-shared-secret>' '${activeUrl}'`, 'curl example')}>Copy curl</button><button type="button" className="rounded border border-slate-600 px-2 py-1" onClick={() => void copy(JSON.stringify({ method: 'POST', url: activeUrl, headers: [{ key: webhook.authenticationHeaderName, value: '<your-shared-secret>' }] }, null, 2), 'Postman example')}>Copy Postman</button></> : null}
      <button type="button" className="rounded border border-sky-600 px-2 py-1 text-sky-100" onClick={() => setEditing((value) => !value)}>{editing ? 'Cancel Edit' : 'Edit'}</button>
      <button type="button" className="rounded border border-slate-600 px-2 py-1" onClick={async () => { try { await onUpdate({ enabled: !webhook.enabled }); onNotice({ type: 'success', text: `Semantic Webhook ${webhook.enabled ? 'disabled' : 'enabled'}.` }); } catch (error) { onNotice({ type: 'error', text: error instanceof Error ? error.message : 'Update failed.' }); } }}>{webhook.enabled ? 'Disable' : 'Enable'}</button>
      {webhook.hasSharedSecret ? <button type="button" className="rounded border border-amber-600 px-2 py-1 text-amber-200" onClick={async () => { if (!window.confirm('Clear this shared secret?')) return; try { await onUpdate({ clearSharedSecret: true }); onNotice({ type: 'success', text: 'Shared secret cleared.' }); } catch (error) { onNotice({ type: 'error', text: error instanceof Error ? error.message : 'Clear failed.' }); } }}>Clear Secret</button> : null}
      {!compact ? <button type="button" className="rounded border border-rose-700 px-2 py-1 text-rose-200" onClick={async () => { if (!window.confirm('Delete this Semantic Webhook configuration?')) return; try { await onDelete(); onNotice({ type: 'success', text: 'Semantic Webhook deleted.' }); } catch (error) { onNotice({ type: 'error', text: error instanceof Error ? error.message : 'Delete failed.' }); } }}>Delete</button> : null}
    </div>
    {editing ? <form onSubmit={save} className="mt-3 grid gap-3 rounded border border-slate-700 bg-slate-900 p-3 md:grid-cols-2">
      <label className="text-xs text-slate-300">Display name<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm" /></label>
      <label className="text-xs text-slate-300">Restore behavior<select value={restoreMode} onChange={(event) => { const mode = event.target.value as SemanticWebhook['restoreMode']; setRestoreMode(mode); if (mode === 'auto_timeout' && !autoRestoreSeconds) setAutoRestoreSeconds('30'); setTimeoutError(null); }} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm"><option value="explicit_inactive">Explicit Inactive</option><option value="auto_timeout">Auto Restore</option></select></label>
      {restoreMode === 'auto_timeout' ? <label className="text-xs text-slate-300">Auto-restore seconds<input type="number" min="1" max="86400" step="1" required value={autoRestoreSeconds} onChange={(event) => setAutoRestoreSeconds(event.target.value)} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm" />{timeoutError ? <span className="mt-1 block text-rose-300">{timeoutError}</span> : null}</label> : null}
      <label className="text-xs text-slate-300">Set or replace secret <span className="text-slate-500">(blank preserves current)</span><input type="password" value={sharedSecret} onChange={(event) => setSharedSecret(event.target.value)} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm" /></label>
      <div className="flex items-end"><button className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white">Save Changes</button></div>
      <p className="text-xs text-slate-500 md:col-span-2">Condition and webhook key are fixed after creation.</p>
    </form> : null}
  </article>;
}
