import { useEffect, useMemo, useState } from 'react';
import {
  parseScheduleJson,
  type Floodlight,
  type FloodlightUpsertInput,
  type ManualOverrideMode,
  type ScheduleMode,
} from '../api/floodlights';
import {
  useCreateFloodlight,
  useDeleteFloodlight,
  useFloodlights,
  useStandardizeFloodlightConfig,
  useTestFloodlightConnectivity,
  useTurnFloodlightOff,
  useTurnFloodlightOn,
  useUpdateFloodlight,
} from '../hooks/useFloodlights';

type FloodlightFormValues = {
  name: string;
  shellyHost: string;
  shellyPort: number;
  relayId: number;
  authEnabled: boolean;
  shellyPassword: string;
  webhookKey: string;
  sharedSecret: string;
  automationEnabled: boolean;
  manualOverrideMode: ManualOverrideMode;
  autoOffSeconds: number;
  retriggerMode: string;
  debounceSeconds: number;
  cooldownSeconds: number;
  testModeEnabled: boolean;
  scheduleMode: ScheduleMode;
  fixedWindowStart: string;
  fixedWindowEnd: string;
  sunsetOffsetMinutes: number;
  sunriseOffsetMinutes: number;
  advancedScheduleJson: string;
};

const defaultFormValues: FloodlightFormValues = {
  name: '',
  shellyHost: '',
  shellyPort: 80,
  relayId: 0,
  authEnabled: false,
  shellyPassword: '',
  webhookKey: '',
  sharedSecret: '',
  automationEnabled: true,
  manualOverrideMode: 'none',
  autoOffSeconds: 120,
  retriggerMode: 'reset_full_duration',
  debounceSeconds: 0,
  cooldownSeconds: 0,
  testModeEnabled: false,
  scheduleMode: 'always',
  fixedWindowStart: '22:00',
  fixedWindowEnd: '06:00',
  sunsetOffsetMinutes: -30,
  sunriseOffsetMinutes: 30,
  advancedScheduleJson: '{}',
};

function buildScheduleJson(values: FloodlightFormValues): Record<string, unknown> {
  if (values.scheduleMode === 'fixed_window') {
    return { start: values.fixedWindowStart, end: values.fixedWindowEnd };
  }

  if (values.scheduleMode === 'astro_offset') {
    return {
      sunsetOffsetMinutes: values.sunsetOffsetMinutes,
      sunriseOffsetMinutes: values.sunriseOffsetMinutes,
    };
  }

  return {};
}

function normalizeFormValues(values: FloodlightFormValues): FloodlightUpsertInput {
  let parsedAdvanced: Record<string, unknown> | null = null;

  try {
    parsedAdvanced = JSON.parse(values.advancedScheduleJson) as Record<string, unknown>;
  } catch {
    parsedAdvanced = null;
  }

  return {
    name: values.name,
    shellyHost: values.shellyHost,
    shellyPort: Number(values.shellyPort),
    relayId: Number(values.relayId),
    authEnabled: values.authEnabled,
    shellyPassword: values.shellyPassword || undefined,
    webhookKey: values.webhookKey || undefined,
    sharedSecret: values.sharedSecret || undefined,
    automationEnabled: values.automationEnabled,
    manualOverrideMode: values.manualOverrideMode,
    autoOffSeconds: Number(values.autoOffSeconds),
    retriggerMode: values.retriggerMode,
    debounceSeconds: Number(values.debounceSeconds),
    cooldownSeconds: Number(values.cooldownSeconds),
    testModeEnabled: values.testModeEnabled,
    scheduleMode: values.scheduleMode,
    scheduleJson: parsedAdvanced ?? buildScheduleJson(values),
  };
}

function mapFloodlightToFormValues(floodlight: Floodlight): FloodlightFormValues {
  const scheduleJson = parseScheduleJson(floodlight.scheduleJson);

  return {
    name: floodlight.name,
    shellyHost: floodlight.shellyHost,
    shellyPort: floodlight.shellyPort,
    relayId: floodlight.relayId,
    authEnabled: floodlight.authEnabled,
    shellyPassword: '',
    webhookKey: floodlight.webhookKey ?? '',
    sharedSecret: '',
    automationEnabled: floodlight.automationEnabled,
    manualOverrideMode: floodlight.manualOverrideMode,
    autoOffSeconds: floodlight.autoOffSeconds,
    retriggerMode: floodlight.retriggerMode,
    debounceSeconds: floodlight.debounceSeconds,
    cooldownSeconds: floodlight.cooldownSeconds,
    testModeEnabled: floodlight.testModeEnabled,
    scheduleMode: floodlight.scheduleMode,
    fixedWindowStart: typeof scheduleJson.start === 'string' ? scheduleJson.start : '22:00',
    fixedWindowEnd: typeof scheduleJson.end === 'string' ? scheduleJson.end : '06:00',
    sunsetOffsetMinutes:
      typeof scheduleJson.sunsetOffsetMinutes === 'number' ? scheduleJson.sunsetOffsetMinutes : -30,
    sunriseOffsetMinutes:
      typeof scheduleJson.sunriseOffsetMinutes === 'number' ? scheduleJson.sunriseOffsetMinutes : 30,
    advancedScheduleJson: JSON.stringify(scheduleJson, null, 2),
  };
}

export function FloodlightsPage() {
  const { data, isLoading, isError, error } = useFloodlights();
  const createMutation = useCreateFloodlight();
  const updateMutation = useUpdateFloodlight();
  const deleteMutation = useDeleteFloodlight();
  const onMutation = useTurnFloodlightOn();
  const offMutation = useTurnFloodlightOff();
  const testMutation = useTestFloodlightConnectivity();
  const standardizeMutation = useStandardizeFloodlightConfig();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<FloodlightFormValues>(defaultFormValues);

  useEffect(() => {
    setFormValues((current) => ({
      ...current,
      advancedScheduleJson: JSON.stringify(buildScheduleJson(current), null, 2),
    }));
  }, [formValues.scheduleMode, formValues.fixedWindowStart, formValues.fixedWindowEnd, formValues.sunsetOffsetMinutes, formValues.sunriseOffsetMinutes]);

  const submitLabel = editingId === null ? 'Create Floodlight' : 'Save Changes';

  const currentEdit = useMemo(
    () => data?.find((floodlight) => floodlight.id === editingId) ?? null,
    [data, editingId],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = normalizeFormValues(formValues);

    if (editingId === null) {
      await createMutation.mutateAsync(payload);
      setFormValues(defaultFormValues);
      return;
    }

    await updateMutation.mutateAsync({ id: editingId, input: payload });
  }

  function startCreate() {
    setEditingId(null);
    setFormValues(defaultFormValues);
  }

  function startEdit(floodlight: Floodlight) {
    setEditingId(floodlight.id);
    setFormValues(mapFloodlightToFormValues(floodlight));
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Floodlights Admin</h1>
        <p className="text-sm text-slate-400">Installer-focused configuration and service actions.</p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
        <div className="space-y-4">
          {isLoading && <p className="text-slate-300">Loading floodlights…</p>}
          {isError && (
            <p className="rounded-md border border-red-600/40 bg-red-950/40 p-3 text-red-200">
              Failed to load floodlights: {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          )}

          {!isLoading && !isError && data?.length === 0 && (
            <p className="rounded-md border border-slate-700 bg-slate-900 p-4 text-slate-300">
              No floodlights found.
            </p>
          )}

          <div className="space-y-3">
            {data?.map((floodlight) => (
              <article key={floodlight.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-200">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold text-white">{floodlight.name}</h2>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => onMutation.mutate(floodlight.id)} className="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">ON</button>
                    <button type="button" onClick={() => offMutation.mutate(floodlight.id)} className="rounded bg-slate-600 px-2 py-1 text-xs font-semibold text-white">OFF</button>
                    <button type="button" onClick={() => startEdit(floodlight)} className="rounded bg-sky-700 px-2 py-1 text-xs font-semibold text-white">Edit</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete floodlight \"${floodlight.name}\"?`)) {
                          deleteMutation.mutate(floodlight.id);
                        }
                      }}
                      className="rounded bg-red-700 px-2 py-1 text-xs font-semibold text-white"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
                  <p><strong>Name:</strong> {floodlight.name}</p>
                  <p><strong>Shelly Host:</strong> {floodlight.shellyHost}</p>
                  <p><strong>Webhook Key:</strong> {floodlight.webhookKey ?? '—'}</p>
                  <p><strong>Online Status:</strong> {floodlight.onlineStatus}</p>
                  <p><strong>Last Known Output:</strong> {String(Boolean(floodlight.lastKnownOutput))}</p>
                  <p><strong>Automation Enabled:</strong> {String(floodlight.automationEnabled)}</p>
                  <p><strong>Test Mode Enabled:</strong> {String(floodlight.testModeEnabled)}</p>
                  <p><strong>Manual Override:</strong> {floodlight.manualOverrideMode}</p>
                  <p><strong>Schedule Mode:</strong> {floodlight.scheduleMode}</p>
                  <p><strong>Last Command Status:</strong> {floodlight.lastCommandStatus ?? '—'}</p>
                  <p><strong>Last Seen At:</strong> {floodlight.lastSeenAt ?? '—'}</p>
                  <p><strong>Test Mode Until:</strong> {floodlight.testModeUntil ?? '—'}</p>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => testMutation.mutate(floodlight.id)}
                    className="rounded border border-slate-500 px-2 py-1 text-xs"
                  >
                    Test Connectivity
                  </button>
                  <button
                    type="button"
                    onClick={() => standardizeMutation.mutate(floodlight.id)}
                    className="rounded border border-slate-500 px-2 py-1 text-xs"
                  >
                    Standardize Config
                  </button>
                  {/* TODO: If backend service actions change, wire additional buttons to the real route handlers. */}
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">{editingId === null ? 'Create Floodlight' : `Edit #${editingId}`}</h2>
            {editingId !== null && (
              <button type="button" className="text-xs text-slate-300 underline" onClick={startCreate}>
                New
              </button>
            )}
          </div>

          {currentEdit && (
            <p className="mb-3 text-xs text-slate-400">
              Editing <strong>{currentEdit.name}</strong>
            </p>
          )}

          <form className="space-y-3 text-sm" onSubmit={handleSubmit}>
            <label className="block">
              <span>Name</span>
              <input className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.name} onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))} required />
            </label>

            <label className="block">
              <span>Shelly Host</span>
              <input className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.shellyHost} onChange={(e) => setFormValues((v) => ({ ...v, shellyHost: e.target.value }))} required />
            </label>

            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span>Shelly Port</span>
                <input type="number" className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.shellyPort} onChange={(e) => setFormValues((v) => ({ ...v, shellyPort: Number(e.target.value) }))} />
              </label>
              <label className="block">
                <span>Relay ID</span>
                <input type="number" className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.relayId} onChange={(e) => setFormValues((v) => ({ ...v, relayId: Number(e.target.value) }))} />
              </label>
              <label className="block">
                <span>Auto Off (s)</span>
                <input type="number" className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.autoOffSeconds} onChange={(e) => setFormValues((v) => ({ ...v, autoOffSeconds: Number(e.target.value) }))} />
              </label>
            </div>

            <label className="block">
              <span>Webhook Key</span>
              <input className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.webhookKey} onChange={(e) => setFormValues((v) => ({ ...v, webhookKey: e.target.value }))} />
            </label>

            <label className="block">
              <span>Shared Secret</span>
              <input className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.sharedSecret} onChange={(e) => setFormValues((v) => ({ ...v, sharedSecret: e.target.value }))} />
            </label>

            <label className="block">
              <span>Shelly Password</span>
              <input type="password" className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.shellyPassword} onChange={(e) => setFormValues((v) => ({ ...v, shellyPassword: e.target.value }))} />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={formValues.authEnabled} onChange={(e) => setFormValues((v) => ({ ...v, authEnabled: e.target.checked }))} />
                Auth Enabled
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={formValues.automationEnabled} onChange={(e) => setFormValues((v) => ({ ...v, automationEnabled: e.target.checked }))} />
                Automation Enabled
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={formValues.testModeEnabled} onChange={(e) => setFormValues((v) => ({ ...v, testModeEnabled: e.target.checked }))} />
                Test Mode Enabled
              </label>
            </div>

            <p className="rounded border border-amber-700/40 bg-amber-950/30 p-2 text-xs text-amber-200">
              Test Mode bypasses scheduling restrictions, but auth/debounce/cooldown/overrides/timers still apply.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <label>
                <span>Manual Override</span>
                <select className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.manualOverrideMode} onChange={(e) => setFormValues((v) => ({ ...v, manualOverrideMode: e.target.value as ManualOverrideMode }))}>
                  <option value="none">none</option>
                  <option value="force_on">force_on</option>
                  <option value="force_off">force_off</option>
                  <option value="suspended">suspended</option>
                </select>
              </label>
              <label>
                <span>Retrigger Mode</span>
                <input className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.retriggerMode} onChange={(e) => setFormValues((v) => ({ ...v, retriggerMode: e.target.value }))} />
              </label>
              <label>
                <span>Debounce (s)</span>
                <input type="number" className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.debounceSeconds} onChange={(e) => setFormValues((v) => ({ ...v, debounceSeconds: Number(e.target.value) }))} />
              </label>
              <label>
                <span>Cooldown (s)</span>
                <input type="number" className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.cooldownSeconds} onChange={(e) => setFormValues((v) => ({ ...v, cooldownSeconds: Number(e.target.value) }))} />
              </label>
            </div>

            <label>
              <span>Schedule Mode</span>
              <select className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.scheduleMode} onChange={(e) => setFormValues((v) => ({ ...v, scheduleMode: e.target.value as ScheduleMode }))}>
                <option value="always">always</option>
                <option value="fixed_window">fixed_window</option>
                <option value="sunset_to_sunrise">sunset_to_sunrise</option>
                <option value="astro_offset">astro_offset</option>
              </select>
            </label>

            {formValues.scheduleMode === 'fixed_window' && (
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span>Start</span>
                  <input type="time" className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.fixedWindowStart} onChange={(e) => setFormValues((v) => ({ ...v, fixedWindowStart: e.target.value }))} />
                </label>
                <label>
                  <span>End</span>
                  <input type="time" className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.fixedWindowEnd} onChange={(e) => setFormValues((v) => ({ ...v, fixedWindowEnd: e.target.value }))} />
                </label>
              </div>
            )}

            {formValues.scheduleMode === 'astro_offset' && (
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span>Sunset Offset (min)</span>
                  <input type="number" className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.sunsetOffsetMinutes} onChange={(e) => setFormValues((v) => ({ ...v, sunsetOffsetMinutes: Number(e.target.value) }))} />
                </label>
                <label>
                  <span>Sunrise Offset (min)</span>
                  <input type="number" className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={formValues.sunriseOffsetMinutes} onChange={(e) => setFormValues((v) => ({ ...v, sunriseOffsetMinutes: Number(e.target.value) }))} />
                </label>
              </div>
            )}

            {(formValues.scheduleMode === 'sunset_to_sunrise' || formValues.scheduleMode === 'astro_offset') && (
              <p className="text-xs text-slate-400">Astro-based modes require Settings latitude/longitude/timezone or backend may return <code>astro_config_missing</code>.</p>
            )}

            <label>
              <span>Advanced scheduleJson</span>
              <textarea className="mt-1 h-24 w-full rounded bg-slate-800 px-2 py-1 font-mono text-xs" value={formValues.advancedScheduleJson} onChange={(e) => setFormValues((v) => ({ ...v, advancedScheduleJson: e.target.value }))} />
            </label>

            <button
              type="submit"
              className="w-full rounded bg-indigo-600 px-3 py-2 font-semibold text-white"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {submitLabel}
            </button>
          </form>
        </aside>
      </div>
    </section>
  );
}
