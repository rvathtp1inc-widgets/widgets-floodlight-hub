import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { parseScheduleJson, type ScheduleMode } from '../api/floodlights';
import { fetchFloodlightSummaries, type Group, type GroupUpsertInput } from '../api/groups';
import {
  useCreateGroup,
  useDeleteGroup,
  useGroupMemberships,
  useGroups,
  useTriggerGroupTest,
  useUpdateGroup,
} from '../hooks/useGroups';

type GroupFormValues = {
  name: string;
  webhookKey: string;
  sharedSecret: string;
  automationEnabled: boolean;
  testModeEnabled: boolean;
  autoOffSeconds: number;
  retriggerMode: string;
  debounceSeconds: number;
  cooldownSeconds: number;
  scheduleMode: ScheduleMode;
  fixedWindowStart: string;
  fixedWindowEnd: string;
  sunsetOffsetMinutes: number;
  sunriseOffsetMinutes: number;
  notes: string;
  advancedScheduleJson: string;
  memberFloodlightIds: number[];
};

type ActionMessage = { type: 'success' | 'error'; text: string } | null;

type HubSettings = { defaultWebhookHeaderName?: string };

const defaultValues: GroupFormValues = {
  name: '',
  webhookKey: '',
  sharedSecret: '',
  automationEnabled: true,
  testModeEnabled: false,
  autoOffSeconds: 120,
  retriggerMode: 'reset_full_duration',
  debounceSeconds: 0,
  cooldownSeconds: 0,
  scheduleMode: 'always',
  fixedWindowStart: '22:00',
  fixedWindowEnd: '06:00',
  sunsetOffsetMinutes: -30,
  sunriseOffsetMinutes: 30,
  notes: '',
  advancedScheduleJson: '{}',
  memberFloodlightIds: [],
};

const retriggerOptions = ['reset_full_duration', 'ignore_while_on'];
const inputClass = 'mt-1 w-full rounded bg-slate-800 px-2 py-1';

function InfoLabel({ label, helpText }: { label: string; helpText?: string }) {
  return (
    <span className="flex items-center gap-1">
      <span>{label}</span>
      {helpText && (
        <span title={helpText} aria-label={helpText} className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-500 text-[10px] font-semibold text-slate-300">i</span>
      )}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-3">
      <h3 className="mb-2 text-sm font-semibold text-white">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

function buildScheduleJson(values: GroupFormValues): Record<string, unknown> {
  if (values.scheduleMode === 'fixed_window') return { start: values.fixedWindowStart, end: values.fixedWindowEnd };
  if (values.scheduleMode === 'astro_offset') return { sunsetOffsetMinutes: values.sunsetOffsetMinutes, sunriseOffsetMinutes: values.sunriseOffsetMinutes };
  return {};
}

function toPayload(values: GroupFormValues): GroupUpsertInput {
  let parsedAdvanced: Record<string, unknown> | null = null;
  try { parsedAdvanced = JSON.parse(values.advancedScheduleJson) as Record<string, unknown>; } catch { parsedAdvanced = null; }

  return {
    name: values.name,
    webhookKey: values.webhookKey,
    sharedSecret: values.sharedSecret.trim() || undefined,
    automationEnabled: values.automationEnabled,
    testModeEnabled: values.testModeEnabled,
    autoOffSeconds: Number(values.autoOffSeconds),
    retriggerMode: values.retriggerMode,
    debounceSeconds: Number(values.debounceSeconds),
    cooldownSeconds: Number(values.cooldownSeconds),
    scheduleMode: values.scheduleMode,
    scheduleJson: parsedAdvanced ?? buildScheduleJson(values),
    notes: values.notes,
    memberFloodlightIds: values.memberFloodlightIds,
  };
}

function mapToForm(group: Group, members: number[]): GroupFormValues {
  const scheduleJson = parseScheduleJson(group.scheduleJson);
  return {
    name: group.name,
    webhookKey: group.webhookKey,
    sharedSecret: '',
    automationEnabled: group.automationEnabled,
    testModeEnabled: group.testModeEnabled,
    autoOffSeconds: group.autoOffSeconds,
    retriggerMode: group.retriggerMode,
    debounceSeconds: group.debounceSeconds,
    cooldownSeconds: group.cooldownSeconds,
    scheduleMode: group.scheduleMode,
    fixedWindowStart: typeof scheduleJson.start === 'string' ? scheduleJson.start : '22:00',
    fixedWindowEnd: typeof scheduleJson.end === 'string' ? scheduleJson.end : '06:00',
    sunsetOffsetMinutes: typeof scheduleJson.sunsetOffsetMinutes === 'number' ? scheduleJson.sunsetOffsetMinutes : -30,
    sunriseOffsetMinutes: typeof scheduleJson.sunriseOffsetMinutes === 'number' ? scheduleJson.sunriseOffsetMinutes : 30,
    notes: group.notes ?? '',
    advancedScheduleJson: JSON.stringify(scheduleJson, null, 2),
    memberFloodlightIds: members,
  };
}

function buildAbsoluteWebhookUrl(origin: string, webhookKey: string): string {
  return `${origin}/api/webhooks/unifi/${webhookKey || '{groupWebhookKey}'}`;
}

function getErrorMessage(error: unknown): string {
  const axiosError = error as AxiosError<{ message?: string; error?: string }>;
  return axiosError.response?.data?.message ?? axiosError.response?.data?.error ?? (error instanceof Error ? error.message : 'Unknown error');
}

async function copyToClipboard(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  throw new Error('Clipboard unavailable');
}

export function GroupsPage() {
  const { data: groups, isLoading, isError, error } = useGroups();
  const { data: floodlights } = useQuery({ queryKey: ['group-floodlights'], queryFn: fetchFloodlightSummaries });
  const settingsQuery = useQuery({
    queryKey: ['hub-settings'],
    queryFn: async (): Promise<HubSettings> => {
      const response = await fetch('/api/settings');
      if (!response.ok) throw new Error('Failed to load settings');
      return (await response.json()) as HubSettings;
    },
  });

  const groupIds = useMemo(() => (groups ?? []).map((item) => item.id), [groups]);
  const membershipQuery = useGroupMemberships(groupIds);

  const createMutation = useCreateGroup();
  const updateMutation = useUpdateGroup();
  const deleteMutation = useDeleteGroup();
  const triggerTestMutation = useTriggerGroupTest();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<GroupFormValues>(defaultValues);
  const [webhookManuallyEdited, setWebhookManuallyEdited] = useState(false);
  const [clearSharedSecret, setClearSharedSecret] = useState(false);
  const [actionMessage, setActionMessage] = useState<ActionMessage>(null);
  const [hubOrigin, setHubOrigin] = useState('http://localhost:3000');

  const currentEdit = useMemo(() => groups?.find((g) => g.id === editingId) ?? null, [groups, editingId]);

  useEffect(() => {
    if (!actionMessage || typeof window === 'undefined') return;
    const timeout = window.setTimeout(() => setActionMessage(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [actionMessage]);

  useEffect(() => {
    if (typeof window !== 'undefined') setHubOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (webhookManuallyEdited) return;
    setFormValues((current) => {
      const base = slugify(current.name) || 'group';
      const keys = new Set((groups ?? []).filter((g) => g.id !== editingId).map((g) => g.webhookKey));
      let next = base;
      let idx = 1;
      while (keys.has(next)) {
        next = `${base}-${idx}`;
        idx += 1;
      }
      if (current.webhookKey === next) return current;
      return { ...current, webhookKey: next };
    });
  }, [formValues.name, groups, editingId, webhookManuallyEdited]);

  useEffect(() => {
    setFormValues((current) => ({ ...current, advancedScheduleJson: JSON.stringify(buildScheduleJson(current), null, 2) }));
  }, [formValues.scheduleMode, formValues.fixedWindowStart, formValues.fixedWindowEnd, formValues.sunsetOffsetMinutes, formValues.sunriseOffsetMinutes]);

  const headerName = settingsQuery.data?.defaultWebhookHeaderName || 'X-Widgets-Secret';

  function show(type: 'success' | 'error', text: string) { setActionMessage({ type, text }); }

  function startCreate() {
    setEditingId(null);
    setFormValues(defaultValues);
    setWebhookManuallyEdited(false);
    setClearSharedSecret(false);
  }

  function startEdit(group: Group) {
    setEditingId(group.id);
    setFormValues(mapToForm(group, membershipQuery.memberships[group.id] ?? []));
    setWebhookManuallyEdited(true);
    setClearSharedSecret(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = toPayload(formValues);
    if (editingId !== null) {
      payload.clearSharedSecret = clearSharedSecret;
      if (!formValues.sharedSecret.trim() || clearSharedSecret) delete payload.sharedSecret;
    }

    try {
      if (editingId === null) {
        await createMutation.mutateAsync(payload);
        show('success', 'Group created successfully.');
        startCreate();
      } else {
        await updateMutation.mutateAsync({ id: editingId, input: payload });
        show('success', 'Group updated successfully.');
      }
    } catch (submitError) {
      show('error', `Save failed: ${getErrorMessage(submitError)}`);
    }
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Groups Admin</h1>
        <p className="text-sm text-slate-400">Installer-focused group scheduling, membership, and webhook controls.</p>
      </header>

      {actionMessage && (
        <div className="fixed right-4 top-4 z-50 max-w-md">
          <p className={`rounded-md border p-3 text-sm shadow-xl ${actionMessage.type === 'success' ? 'border-emerald-500/40 bg-emerald-900/90 text-emerald-200' : 'border-red-600/40 bg-red-950/90 text-red-200'}`}>{actionMessage.text}</p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
        <div className="space-y-3">
          {isLoading && <p className="text-slate-300">Loading groups…</p>}
          {isError && <p className="rounded-md border border-red-600/40 bg-red-950/40 p-3 text-red-200">Failed to load groups: {error instanceof Error ? error.message : 'Unknown error'}</p>}
          {!isLoading && !isError && groups?.length === 0 && <p className="rounded-md border border-slate-700 bg-slate-900 p-4 text-slate-300">No groups found.</p>}

          {groups?.map((group) => {
            const members = membershipQuery.memberships[group.id] ?? [];
            const absoluteUrl = buildAbsoluteWebhookUrl(hubOrigin, group.webhookKey);
            const curl = `curl -X POST '${absoluteUrl}' -H '${headerName}: {sharedSecret}' -H 'Content-Type: application/json' -d '{}'`;
            return (
              <article key={group.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-200">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-white">{group.name}</h2>
                    <p className="text-xs text-slate-400">Group Behavior: Group activation is evaluated at the group level first, then member floodlights are processed individually. A member floodlight may still be skipped due to override or other automation conditions.</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => startEdit(group)} className="rounded bg-sky-700 px-2 py-1 text-xs font-semibold text-white">Edit</button>
                    <button
                      type="button"
                      className="rounded bg-red-700 px-2 py-1 text-xs font-semibold text-white"
                      onClick={async () => {
                        if (!window.confirm(`Delete group \"${group.name}\"? This also removes its membership assignments.`)) return;
                        try {
                          await deleteMutation.mutateAsync(group.id);
                          show('success', `Group deleted: ${group.name}`);
                          if (editingId === group.id) startCreate();
                        } catch (deleteError) {
                          show('error', `Delete failed: ${getErrorMessage(deleteError)}`);
                        }
                      }}
                    >Delete</button>
                  </div>
                </div>

                <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
                  <p><strong>Webhook Key:</strong> {group.webhookKey}</p>
                  <p><strong>Members:</strong> {members.length}</p>
                  <p><strong>Automation:</strong> {group.automationEnabled ? 'Enabled' : 'Disabled'}</p>
                  <p><strong>Test Mode:</strong> {group.testModeEnabled ? 'Enabled' : 'Disabled'}</p>
                  <p><strong>Schedule Mode:</strong> {group.scheduleMode}</p>
                  <p><strong>Auto Off:</strong> {group.autoOffSeconds}s</p>
                  <p><strong>Debounce/Cooldown:</strong> {group.debounceSeconds}s / {group.cooldownSeconds}s</p>
                  <p><strong>Auth Secret:</strong> {group.hasSharedSecret ? 'Configured' : 'Not set'}</p>
                </div>

                {group.notes && <p className="mt-2 rounded border border-slate-700 bg-slate-950/40 p-2 text-xs text-slate-300"><strong>Notes:</strong> {group.notes}</p>}

                <div className="mt-3 rounded border border-slate-700 bg-slate-950/40 p-3 text-xs text-slate-300">
                  <h4 className="mb-1 text-sm font-semibold text-white">Group Webhook</h4>
                  <p><strong>Webhook Key:</strong> {group.webhookKey}</p>
                  <p><strong>URL:</strong> {absoluteUrl}</p>
                  <p><strong>Header Name:</strong> {headerName}</p>
                  <p><strong>Secret:</strong> {group.hasSharedSecret ? 'Configured (required)' : 'Not set (requests likely rejected)'}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="rounded border border-slate-500 px-2 py-1" onClick={() => void copyToClipboard(absoluteUrl).then(() => show('success', `URL copied for ${group.name}`)).catch(() => show('error', 'Copy failed.'))}>Copy URL</button>
                    <button type="button" className="rounded border border-slate-500 px-2 py-1" onClick={() => void copyToClipboard(`${headerName}: {sharedSecret}`).then(() => show('success', `Header copied for ${group.name}`)).catch(() => show('error', 'Copy failed.'))}>Copy Header</button>
                    <button type="button" className="rounded border border-slate-500 px-2 py-1" onClick={() => void copyToClipboard(curl).then(() => show('success', `Example copied for ${group.name}`)).catch(() => show('error', 'Copy failed.'))}>Copy Example</button>
                    <button
                      type="button"
                      className="rounded border border-indigo-500/60 px-2 py-1"
                      onClick={async () => {
                        try {
                          const result = await triggerTestMutation.mutateAsync(group.id);
                          show('success', `Group test route available at ${result.webhookUrl}`);
                        } catch (testError) {
                          show('error', `Group test action failed: ${getErrorMessage(testError)}`);
                        }
                      }}
                    >Test Group Webhook</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">{editingId === null ? 'Create Group' : `Editing: ${currentEdit?.name ?? 'Group'}`}</h2>
            {editingId !== null && <button type="button" className="text-xs text-slate-300 underline" onClick={startCreate}>New</button>}
          </div>

          <form className="space-y-3 text-sm" onSubmit={onSubmit}>
            <Section title="Identity">
              <label className="block">
                <InfoLabel label="Name" />
                <input required className={inputClass} value={formValues.name} onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))} />
              </label>
            </Section>

            <Section title="Webhook & Authentication">
              <label className="block">
                <InfoLabel label="Group Webhook Key" helpText="Unique identifier used in the group webhook URL. External systems use this to trigger the group." />
                <input className={inputClass} value={formValues.webhookKey} onChange={(e) => { setWebhookManuallyEdited(true); setFormValues((v) => ({ ...v, webhookKey: slugify(e.target.value) })); }} required />
              </label>
              <label className="block">
                <InfoLabel label="Group Shared Secret" helpText="A secret value external systems must include in the request header. The Widgets UF-Hub rejects requests that do not include this value." />
                <input className={inputClass} value={formValues.sharedSecret} onChange={(e) => { setClearSharedSecret(false); setFormValues((v) => ({ ...v, sharedSecret: e.target.value })); }} />
                {editingId !== null && (
                  <>
                    <p className="mt-1 text-xs text-slate-300">Shared Secret: {currentEdit?.hasSharedSecret ? '••••• (Configured)' : 'Not set'}</p>
                    <p className="mt-1 text-xs text-slate-400">Enter a new value to replace existing secret. Leave blank to keep current value.</p>
                    {currentEdit?.hasSharedSecret && <button type="button" className="mt-1 rounded border border-amber-500/60 px-2 py-1 text-xs text-amber-200" onClick={() => { if (window.confirm('Clear group shared secret on save?')) { setClearSharedSecret(true); setFormValues((v) => ({ ...v, sharedSecret: '' })); show('success', 'Shared secret marked for removal. Save to apply.'); } }}>Clear Shared Secret</button>}
                  </>
                )}
              </label>

              <div className="rounded border border-slate-700 bg-slate-950/40 p-3 text-xs text-slate-300">
                <p><strong>URL:</strong> {buildAbsoluteWebhookUrl(hubOrigin, formValues.webhookKey)}</p>
                <p><strong>Header:</strong> {headerName}: {formValues.sharedSecret || '{sharedSecret}'}</p>
              </div>
            </Section>

            <Section title="Automation & Timers">
              <label className="flex items-center gap-2"><input type="checkbox" checked={formValues.automationEnabled} onChange={(e) => setFormValues((v) => ({ ...v, automationEnabled: e.target.checked }))} /><InfoLabel label="Automation Enabled" /></label>
              <label><InfoLabel label="Auto Off (seconds)" /><input type="number" className={inputClass} value={formValues.autoOffSeconds} onChange={(e) => setFormValues((v) => ({ ...v, autoOffSeconds: Number(e.target.value) }))} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label><InfoLabel label="Retrigger Mode" /><select className={inputClass} value={formValues.retriggerMode} onChange={(e) => setFormValues((v) => ({ ...v, retriggerMode: e.target.value }))}>{retriggerOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                <label><InfoLabel label="Debounce (seconds)" /><input type="number" className={inputClass} value={formValues.debounceSeconds} onChange={(e) => setFormValues((v) => ({ ...v, debounceSeconds: Number(e.target.value) }))} /></label>
                <label><InfoLabel label="Cooldown (seconds)" /><input type="number" className={inputClass} value={formValues.cooldownSeconds} onChange={(e) => setFormValues((v) => ({ ...v, cooldownSeconds: Number(e.target.value) }))} /></label>
              </div>
            </Section>

            <Section title="Scheduling">
              <label className="block"><InfoLabel label="Schedule Mode" /><select className={inputClass} value={formValues.scheduleMode} onChange={(e) => setFormValues((v) => ({ ...v, scheduleMode: e.target.value as ScheduleMode }))}><option value="always">always</option><option value="fixed_window">fixed_window</option><option value="sunset_to_sunrise">sunset_to_sunrise</option><option value="astro_offset">astro_offset</option></select></label>
              {formValues.scheduleMode === 'fixed_window' && <div className="grid grid-cols-2 gap-2"><label>Start<input type="time" className={inputClass} value={formValues.fixedWindowStart} onChange={(e) => setFormValues((v) => ({ ...v, fixedWindowStart: e.target.value }))} /></label><label>End<input type="time" className={inputClass} value={formValues.fixedWindowEnd} onChange={(e) => setFormValues((v) => ({ ...v, fixedWindowEnd: e.target.value }))} /></label></div>}
              {formValues.scheduleMode === 'sunset_to_sunrise' && <p className="text-xs text-slate-400">Uses hub location settings (latitude, longitude, timezone).</p>}
              {formValues.scheduleMode === 'astro_offset' && <div className="grid grid-cols-2 gap-2"><label>Sunset Offset<input type="number" className={inputClass} value={formValues.sunsetOffsetMinutes} onChange={(e) => setFormValues((v) => ({ ...v, sunsetOffsetMinutes: Number(e.target.value) }))} /></label><label>Sunrise Offset<input type="number" className={inputClass} value={formValues.sunriseOffsetMinutes} onChange={(e) => setFormValues((v) => ({ ...v, sunriseOffsetMinutes: Number(e.target.value) }))} /></label></div>}
            </Section>

            <Section title="Test Mode">
              <label className="flex items-center gap-2"><input type="checkbox" checked={formValues.testModeEnabled} onChange={(e) => setFormValues((v) => ({ ...v, testModeEnabled: e.target.checked }))} /><InfoLabel label="Group Test Mode" helpText="Temporarily bypasses group scheduling restrictions for testing and commissioning." /></label>
            </Section>

            <Section title="Membership">
              <p className="text-xs text-slate-400">Floodlights assigned to this group can be triggered together through the group webhook.</p>
              <div className="max-h-52 space-y-2 overflow-auto rounded border border-slate-700 bg-slate-950/40 p-2">
                {floodlights?.map((light) => {
                  const checked = formValues.memberFloodlightIds.includes(light.id);
                  return (
                    <label key={light.id} className="flex cursor-pointer items-start gap-2 rounded p-1 hover:bg-slate-800/60">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setFormValues((v) => ({
                            ...v,
                            memberFloodlightIds: e.target.checked
                              ? [...v.memberFloodlightIds, light.id]
                              : v.memberFloodlightIds.filter((id) => id !== light.id),
                          }))
                        }
                      />
                      <span className="text-xs">
                        <span className="font-semibold text-white">{light.name}</span> · key: {light.webhookKey ?? '—'} · {light.onlineStatus} · automation {light.automationEnabled ? 'on' : 'off'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </Section>

            <Section title="Notes">
              <textarea className="h-20 w-full rounded bg-slate-800 px-2 py-1" value={formValues.notes} onChange={(e) => setFormValues((v) => ({ ...v, notes: e.target.value }))} />
            </Section>

            <details className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-white">Advanced / Debug Only — not required for normal setup</summary>
              <textarea className="mt-3 h-24 w-full rounded bg-slate-800 px-2 py-1 font-mono text-xs" value={formValues.advancedScheduleJson} onChange={(e) => setFormValues((v) => ({ ...v, advancedScheduleJson: e.target.value }))} />
            </details>

            <button type="submit" className="w-full rounded bg-indigo-600 px-3 py-2 font-semibold text-white" disabled={createMutation.isPending || updateMutation.isPending || membershipQuery.isLoading}>{editingId === null ? 'Create Group' : 'Save Changes'}</button>
          </form>
        </aside>
      </div>
    </section>
  );
}
