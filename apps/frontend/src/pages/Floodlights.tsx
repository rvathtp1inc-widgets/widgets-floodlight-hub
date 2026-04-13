import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
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

type ActionMessage = { type: 'success' | 'error'; text: string } | null;

type HubSettings = {
  defaultWebhookHeaderName?: string;
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
  scheduleMode: 'sunset_to_sunrise',
  fixedWindowStart: '22:00',
  fixedWindowEnd: '06:00',
  sunsetOffsetMinutes: -30,
  sunriseOffsetMinutes: 30,
  advancedScheduleJson: '{}',
};

const retriggerModeOptions = [
  { value: 'reset_full_duration', label: 'reset_full_duration (recommended)' },
  { value: 'ignore_while_on', label: 'ignore_while_on' },
];

const sharedInputClass = 'mt-1 w-full rounded bg-slate-800 px-2 py-1';

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
    shellyPassword: values.shellyPassword.trim() || undefined,
    webhookKey: values.webhookKey || undefined,
    sharedSecret: values.sharedSecret.trim() || undefined,
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function generateUniqueWebhookKey(
  baseName: string,
  floodlights: Floodlight[] | undefined,
  editingId: number | null,
): string {
  const base = slugify(baseName) || 'floodlight';
  const existing = new Set(
    (floodlights ?? [])
      .filter((item) => item.id !== editingId)
      .map((item) => item.webhookKey)
      .filter((key): key is string => Boolean(key)),
  );

  if (!existing.has(base)) {
    return base;
  }

  let next = 1;
  while (existing.has(`${base}-${next}`)) {
    next += 1;
  }

  return `${base}-${next}`;
}

function InfoLabel({ label, helpText }: { label: string; helpText?: string }) {
  return (
    <span className="flex items-center gap-1">
      <span>{label}</span>
      {helpText && (
        <span
          title={helpText}
          aria-label={helpText}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-500 text-[10px] font-semibold text-slate-300"
        >
          i
        </span>
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

function buildAbsoluteWebhookUrl(origin: string, webhookKey: string): string {
  const key = webhookKey || '{webhookKey}';
  return `${origin}/api/webhooks/unifi/${key}`;
}

async function copyToClipboard(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard not available in this environment.');
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  const copied = document.execCommand('copy');
  document.body.removeChild(textArea);

  if (!copied) {
    throw new Error('Unable to copy to clipboard.');
  }
}

function getErrorMessage(error: unknown): string {
  const axiosError = error as AxiosError<{ message?: string; error?: string }>;
  return axiosError.response?.data?.message ?? axiosError.response?.data?.error ?? (error instanceof Error ? error.message : 'Unknown error');
}

export function FloodlightsPage() {
  const { data, isLoading, isError, error } = useFloodlights();
  const settingsQuery = useQuery({
    queryKey: ['hub-settings'],
    queryFn: async (): Promise<HubSettings> => {
      const response = await fetch('/api/settings');
      if (!response.ok) {
        throw new Error('Failed to load settings');
      }
      return (await response.json()) as HubSettings;
    },
  });

  const createMutation = useCreateFloodlight();
  const updateMutation = useUpdateFloodlight();
  const deleteMutation = useDeleteFloodlight();
  const onMutation = useTurnFloodlightOn();
  const offMutation = useTurnFloodlightOff();
  const testMutation = useTestFloodlightConnectivity();
  const standardizeMutation = useStandardizeFloodlightConfig();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<FloodlightFormValues>(defaultFormValues);
  const [webhookManuallyEdited, setWebhookManuallyEdited] = useState(false);
  const [actionMessage, setActionMessage] = useState<ActionMessage>(null);
  const [hubOrigin, setHubOrigin] = useState<string>('http://localhost:3000');
  const [clearSharedSecret, setClearSharedSecret] = useState(false);
  const [clearShellyPassword, setClearShellyPassword] = useState(false);

  function showActionMessage(type: 'success' | 'error', text: string) {
    setActionMessage({ type, text });
  }

  useEffect(() => {
    if (webhookManuallyEdited) {
      return;
    }

    setFormValues((current) => {
      const suggested = generateUniqueWebhookKey(current.name, data, editingId);
      if (current.webhookKey === suggested) {
        return current;
      }
      return { ...current, webhookKey: suggested };
    });
  }, [formValues.name, data, editingId, webhookManuallyEdited]);

  useEffect(() => {
    setFormValues((current) => ({
      ...current,
      advancedScheduleJson: JSON.stringify(buildScheduleJson(current), null, 2),
    }));
  }, [formValues.scheduleMode, formValues.fixedWindowStart, formValues.fixedWindowEnd, formValues.sunsetOffsetMinutes, formValues.sunriseOffsetMinutes]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setHubOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    if (!actionMessage) {
      return;
    }
    const timeout = window.setTimeout(() => setActionMessage(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [actionMessage]);

  const submitLabel = editingId === null ? 'Create Floodlight' : 'Save Changes';

  const currentEdit = useMemo(
    () => data?.find((floodlight) => floodlight.id === editingId) ?? null,
    [data, editingId],
  );

  const headerName = settingsQuery.data?.defaultWebhookHeaderName || 'X-Widgets-Secret';
  const webhookUrl = buildAbsoluteWebhookUrl(hubOrigin, formValues.webhookKey);
  const headerLine = `${headerName}: ${formValues.sharedSecret || '{sharedSecret}'}`;
  const curlExample = `curl -X POST '${webhookUrl}' -H '${headerLine}' -H 'Content-Type: application/json' -d '{}'`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionMessage(null);

    const payload = normalizeFormValues(formValues);

    if (editingId !== null) {
      payload.clearSharedSecret = clearSharedSecret;
      payload.clearShellyPassword = clearShellyPassword;

      if (!formValues.shellyPassword.trim()) {
        delete payload.shellyPassword;
      }
      if (!formValues.sharedSecret.trim()) {
        delete payload.sharedSecret;
      }
      if (clearShellyPassword) {
        delete payload.shellyPassword;
      }
      if (clearSharedSecret) {
        delete payload.sharedSecret;
      }
    }

    try {
      if (editingId === null) {
        await createMutation.mutateAsync(payload);
        setFormValues(defaultFormValues);
        setWebhookManuallyEdited(false);
        setClearSharedSecret(false);
        setClearShellyPassword(false);
        showActionMessage('success', 'Floodlight created successfully. Recommended next step: run Standardize Config.');
      } else {
        await updateMutation.mutateAsync({ id: editingId, input: payload });
        setClearSharedSecret(false);
        setClearShellyPassword(false);
        showActionMessage('success', 'Floodlight saved successfully.');
      }
    } catch (mutationError) {
      showActionMessage('error', `Save failed: ${getErrorMessage(mutationError)}`);
    }
  }

  function startCreate() {
    setEditingId(null);
    setFormValues(defaultFormValues);
    setWebhookManuallyEdited(false);
    setClearSharedSecret(false);
    setClearShellyPassword(false);
    setActionMessage(null);
  }

  function startEdit(floodlight: Floodlight) {
    setEditingId(floodlight.id);
    setFormValues(mapFloodlightToFormValues(floodlight));
    setWebhookManuallyEdited(true);
    setClearSharedSecret(false);
    setClearShellyPassword(false);
    setActionMessage(null);
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Floodlights Admin</h1>
        <p className="text-sm text-slate-400">Installer-focused configuration and service actions.</p>
      </header>

      {actionMessage && (
        <div className="fixed right-4 top-4 z-50 max-w-md">
          <p
            className={`rounded-md border p-3 text-sm shadow-xl ${
              actionMessage.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-900/90 text-emerald-200'
                : 'border-red-600/40 bg-red-950/90 text-red-200'
            }`}
          >
            {actionMessage.text}
          </p>
        </div>
      )}

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
                  <p><strong>Shelly Device IP:</strong> {floodlight.shellyHost}</p>
                  <p><strong>Webhook Key:</strong> {floodlight.webhookKey ?? '—'}</p>
                  <p><strong>Auto Off:</strong> {floodlight.autoOffSeconds}s</p>
                  <p><strong>Online Status:</strong> {floodlight.onlineStatus}</p>
                  <p><strong>Last Known Output:</strong> {String(Boolean(floodlight.lastKnownOutput))}</p>
                  <p><strong>Automation Enabled:</strong> {String(floodlight.automationEnabled)}</p>
                  <p><strong>Shared Secret:</strong> {floodlight.hasSharedSecret ? 'Configured' : 'Not set'}</p>
                  <p><strong>Shelly Auth:</strong> {floodlight.authEnabled ? 'Enabled' : 'Disabled'}</p>
                  <p><strong>Shelly Password:</strong> {!floodlight.authEnabled ? 'Not required' : floodlight.hasShellyPassword ? 'Configured' : 'Not set'}</p>
                  <p><strong>Test Mode Enabled:</strong> {String(floodlight.testModeEnabled)}</p>
                  <p><strong>Manual Override:</strong> {floodlight.manualOverrideMode}</p>
                  <p><strong>Schedule Mode:</strong> {floodlight.scheduleMode}</p>
                  <p><strong>Last Command Status:</strong> {floodlight.lastCommandStatus ?? '—'}</p>
                  <p><strong>Last Seen At:</strong> {floodlight.lastSeenAt ?? '—'}</p>
                  <p><strong>Test Mode Until:</strong> {floodlight.testModeUntil ?? '—'}</p>
                </div>

                <div className="mt-3 rounded border border-slate-700 bg-slate-950/40 p-3 text-xs text-slate-300">
                  <h4 className="mb-1 text-sm font-semibold text-white">Direct Trigger</h4>
                  <p><strong>Webhook Key:</strong> {floodlight.webhookKey ?? '—'}</p>
                  <p><strong>URL:</strong> {buildAbsoluteWebhookUrl(hubOrigin, floodlight.webhookKey ?? '')}</p>
                  <p><strong>Header Name:</strong> {headerName}</p>
                  <p><strong>Secret:</strong> Shared secret required in header.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded border border-slate-500 px-2 py-1"
                      onClick={() =>
                        void copyToClipboard(buildAbsoluteWebhookUrl(hubOrigin, floodlight.webhookKey ?? ''))
                          .then(() => showActionMessage('success', `Webhook URL copied for ${floodlight.name}`))
                          .catch(() => showActionMessage('error', 'Copy failed. Please copy manually.'))
                      }
                    >
                      Copy URL
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-500 px-2 py-1"
                      onClick={() =>
                        void copyToClipboard(`${headerName}: {sharedSecret}`)
                          .then(() => showActionMessage('success', `Webhook header copied for ${floodlight.name}`))
                          .catch(() => showActionMessage('error', 'Copy failed. Please copy manually.'))
                      }
                    >
                      Copy Header
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-500 px-2 py-1"
                      onClick={() =>
                        void copyToClipboard(
                          `curl -X POST '${buildAbsoluteWebhookUrl(hubOrigin, floodlight.webhookKey ?? '')}' -H '${headerName}: {sharedSecret}' -H 'Content-Type: application/json' -d '{}'`,
                        )
                          .then(() => showActionMessage('success', `Webhook example copied for ${floodlight.name}`))
                          .catch(() => showActionMessage('error', 'Copy failed. Please copy manually.'))
                      }
                    >
                      Copy Example
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const result = await testMutation.mutateAsync(floodlight.id);
                        showActionMessage(
                          result.ok ? 'success' : 'error',
                          result.ok
                            ? `Connectivity test succeeded for ${floodlight.name}`
                            : `Connectivity test failed for ${floodlight.name}: ${result.error ?? 'unknown error'}`,
                        );
                      } catch (mutationError) {
                        showActionMessage('error', `Connectivity test failed for ${floodlight.name}: ${getErrorMessage(mutationError)}`);
                      }
                    }}
                    className="rounded border border-slate-500 px-2 py-1 text-xs"
                  >
                    Test Connectivity
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const result = await standardizeMutation.mutateAsync(floodlight.id);
                        showActionMessage(
                          result.ok ? 'success' : 'error',
                          result.ok
                            ? `Standardize config succeeded for ${floodlight.name}`
                            : `Standardize config failed for ${floodlight.name}`,
                        );
                      } catch (mutationError) {
                        showActionMessage('error', `Standardize config failed for ${floodlight.name}: ${getErrorMessage(mutationError)}`);
                      }
                    }}
                    className="rounded border border-slate-500 px-2 py-1 text-xs"
                    title="Applies the recommended Shelly configuration for this system, including disabling local timers/auto behaviors and preparing the device for hub-managed control. Use this after adding a new device."
                  >
                    Standardize Config
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Standardize Config applies recommended Shelly settings (disables local timers/auto behaviors) so this hub has full control.
                </p>
              </article>
            ))}
          </div>
        </div>

        <aside className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              {editingId === null ? 'Create Floodlight' : `Editing: ${currentEdit?.name ?? 'Floodlight'}`}
            </h2>
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
            <Section title="Identity">
              <label className="block">
                <InfoLabel label="Name" />
                <input className={sharedInputClass} value={formValues.name} onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))} required />
              </label>
            </Section>

            <Section title="Shelly Device Configuration">
              <label className="block">
                <InfoLabel label="Shelly Device IP" helpText="IP address of the Shelly device on the local network. This is where the hub sends control commands." />
                <input className={sharedInputClass} value={formValues.shellyHost} onChange={(e) => setFormValues((v) => ({ ...v, shellyHost: e.target.value }))} required />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <InfoLabel label="Shelly Port" helpText="Network port used by the Shelly device. Default is 80 unless changed in Shelly settings." />
                  <input type="number" className={sharedInputClass} value={formValues.shellyPort} onChange={(e) => setFormValues((v) => ({ ...v, shellyPort: Number(e.target.value) }))} />
                  <p className="mt-1 text-xs text-slate-400">Default: 80</p>
                </label>
                <label className="block">
                  <InfoLabel label="Shelly Relay ID" helpText="Relay/output index on the Shelly device. For most Shelly 1 Mini devices, this is 0." />
                  <input type="number" className={sharedInputClass} value={formValues.relayId} onChange={(e) => setFormValues((v) => ({ ...v, relayId: Number(e.target.value) }))} />
                  <p className="mt-1 text-xs text-slate-400">Default: 0</p>
                </label>
              </div>

              <label className="flex items-center gap-2">
                <input type="checkbox" checked={formValues.authEnabled} onChange={(e) => setFormValues((v) => ({ ...v, authEnabled: e.target.checked }))} />
                <InfoLabel label="Shelly Auth Enabled" helpText="Enable if the Shelly device requires authentication. This setting must match the device configuration." />
              </label>

              <label className="block">
                <InfoLabel label="Shelly Password" helpText="Password used for Shelly authentication. Leave blank if authentication is disabled." />
                <input
                  type="password"
                  className={sharedInputClass}
                  value={formValues.shellyPassword}
                  onChange={(e) => {
                    setClearShellyPassword(false);
                    setFormValues((v) => ({ ...v, shellyPassword: e.target.value }));
                  }}
                />
                {editingId !== null && (
                  <>
                    <p className="mt-1 text-xs text-slate-300">
                      Shelly Password: {currentEdit?.hasShellyPassword ? '••••• (Configured)' : 'Not set'}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">Enter a new value to replace the existing Shelly password. Leave blank to keep the current value.</p>
                    {currentEdit?.hasShellyPassword && (
                      <button
                        type="button"
                        className="mt-1 rounded border border-amber-500/60 px-2 py-1 text-xs text-amber-200"
                        onClick={() => {
                          if (window.confirm('Clear the saved Shelly password for this floodlight?')) {
                            setFormValues((v) => ({ ...v, shellyPassword: '' }));
                            setClearShellyPassword(true);
                            showActionMessage('success', 'Shelly password will be cleared when you save.');
                          }
                        }}
                      >
                        Clear Shelly Password
                      </button>
                    )}
                    {clearShellyPassword && (
                      <p className="mt-1 text-xs text-amber-300">Shelly password is marked for removal. Save to apply.</p>
                    )}
                  </>
                )}
              </label>
            </Section>

            <Section title="Webhook & Authentication">
              <label className="block">
                <InfoLabel label="Webhook Key" helpText="Unique identifier used in the webhook URL. External systems use this to trigger this floodlight." />
                <input
                  className={sharedInputClass}
                  value={formValues.webhookKey}
                  onChange={(e) => {
                    setWebhookManuallyEdited(true);
                    setFormValues((v) => ({ ...v, webhookKey: slugify(e.target.value) }));
                  }}
                />
                <p className="mt-1 text-xs text-slate-400">Auto-suggested from name; you can override.</p>
              </label>

              <label className="block">
                <InfoLabel label="Shared Secret" helpText="A secret value that external systems must include in the request header. The Widgets UF-Hub will reject requests that do not include this value." />
                <input
                  className={sharedInputClass}
                  value={formValues.sharedSecret}
                  onChange={(e) => {
                    setClearSharedSecret(false);
                    setFormValues((v) => ({ ...v, sharedSecret: e.target.value }));
                  }}
                />
                {editingId !== null && (
                  <>
                    <p className="mt-1 text-xs text-slate-300">
                      Shared Secret: {currentEdit?.hasSharedSecret ? '••••• (Configured)' : 'Not set'}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">Enter a new value to replace the existing shared secret. Leave blank to keep the current value.</p>
                    {currentEdit?.hasSharedSecret && (
                      <button
                        type="button"
                        className="mt-1 rounded border border-amber-500/60 px-2 py-1 text-xs text-amber-200"
                        onClick={() => {
                          if (window.confirm('Clear the saved shared secret for this floodlight?')) {
                            setFormValues((v) => ({ ...v, sharedSecret: '' }));
                            setClearSharedSecret(true);
                            showActionMessage('success', 'Shared secret will be cleared when you save.');
                          }
                        }}
                      >
                        Clear Shared Secret
                      </button>
                    )}
                    {clearSharedSecret && (
                      <p className="mt-1 text-xs text-amber-300">Shared secret is marked for removal. Save to apply.</p>
                    )}
                  </>
                )}
              </label>

              <div className="rounded border border-slate-700 bg-slate-950/40 p-3 text-xs text-slate-300">
                <h4 className="mb-2 text-sm font-semibold text-white">Direct Trigger Integration</h4>
                <p className="mb-2 text-slate-400">
                  This endpoint allows external systems (such as UniFi Protect) to trigger this floodlight. The hub evaluates schedule, test mode, debounce, cooldown, overrides, and timers before activation.
                </p>
                <p><strong>Method:</strong> POST</p>
                <p><strong>URL:</strong> {webhookUrl}</p>
                <p><strong>Header Name:</strong> {headerName}</p>
                <p><strong>Header Value:</strong> {formValues.sharedSecret || '{sharedSecret}'}</p>
                <p><strong>Body:</strong> {'{}'}</p>

                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="rounded border border-slate-500 px-2 py-1" onClick={() => void copyToClipboard(webhookUrl).then(() => showActionMessage('success', 'Webhook URL copied')).catch(() => showActionMessage('error', 'Copy failed. Please copy manually.'))}>Copy URL</button>
                  <button type="button" className="rounded border border-slate-500 px-2 py-1" onClick={() => void copyToClipboard(headerLine).then(() => showActionMessage('success', 'Webhook header copied')).catch(() => showActionMessage('error', 'Copy failed. Please copy manually.'))}>Copy Header</button>
                  <button type="button" className="rounded border border-slate-500 px-2 py-1" onClick={() => void copyToClipboard(curlExample).then(() => showActionMessage('success', 'Webhook example copied')).catch(() => showActionMessage('error', 'Copy failed. Please copy manually.'))}>Copy Full Example</button>
                </div>
              </div>
            </Section>

            <Section title="Automation & Timers">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={formValues.automationEnabled} onChange={(e) => setFormValues((v) => ({ ...v, automationEnabled: e.target.checked }))} />
                <InfoLabel label="Automation Enabled" helpText="When disabled, this floodlight will ignore all automated triggers." />
              </label>

              <label className="block">
                <InfoLabel label="Auto Off (seconds)" helpText="How long the light stays on after activation before turning off automatically." />
                <input type="number" className={sharedInputClass} value={formValues.autoOffSeconds} onChange={(e) => setFormValues((v) => ({ ...v, autoOffSeconds: Number(e.target.value) }))} />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <InfoLabel label="Retrigger Mode" helpText="Defines behavior when a new trigger occurs while the light is already on. Default resets the timer." />
                  <select className={sharedInputClass} value={formValues.retriggerMode} onChange={(e) => setFormValues((v) => ({ ...v, retriggerMode: e.target.value }))}>
                    {retriggerModeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                    {!retriggerModeOptions.some((option) => option.value === formValues.retriggerMode) && (
                      <option value={formValues.retriggerMode}>{formValues.retriggerMode}</option>
                    )}
                  </select>
                  <p className="mt-1 text-xs text-slate-400">Default: reset_full_duration</p>
                </label>
                <label className="block">
                  <InfoLabel label="Debounce (seconds)" helpText="Ignores repeated triggers that occur too quickly." />
                  <input type="number" className={sharedInputClass} value={formValues.debounceSeconds} onChange={(e) => setFormValues((v) => ({ ...v, debounceSeconds: Number(e.target.value) }))} />
                </label>
                <label className="block">
                  <InfoLabel label="Cooldown (seconds)" helpText="Prevents new activations for a short period after a trigger." />
                  <input type="number" className={sharedInputClass} value={formValues.cooldownSeconds} onChange={(e) => setFormValues((v) => ({ ...v, cooldownSeconds: Number(e.target.value) }))} />
                </label>
              </div>
            </Section>

            <Section title="Scheduling">
              <label className="block">
                <InfoLabel label="Schedule Mode" helpText="Defines when this floodlight is allowed to respond to events." />
                <select className={sharedInputClass} value={formValues.scheduleMode} onChange={(e) => setFormValues((v) => ({ ...v, scheduleMode: e.target.value as ScheduleMode }))}>
                  <option value="always">always</option>
                  <option value="fixed_window">fixed_window</option>
                  <option value="sunset_to_sunrise">sunset_to_sunrise</option>
                  <option value="astro_offset">astro_offset</option>
                </select>
                <p className="mt-1 text-xs text-slate-400">Default: sunset_to_sunrise</p>
              </label>

              {formValues.scheduleMode === 'fixed_window' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span>Start time</span>
                      <input type="time" className={sharedInputClass} value={formValues.fixedWindowStart} onChange={(e) => setFormValues((v) => ({ ...v, fixedWindowStart: e.target.value }))} />
                    </label>
                    <label>
                      <span>End time</span>
                      <input type="time" className={sharedInputClass} value={formValues.fixedWindowEnd} onChange={(e) => setFormValues((v) => ({ ...v, fixedWindowEnd: e.target.value }))} />
                    </label>
                  </div>
                  <p className="text-xs text-slate-400">Overnight windows supported (e.g., 22:00 → 06:00)</p>
                </>
              )}

              {formValues.scheduleMode === 'sunset_to_sunrise' && (
                <p className="text-xs text-slate-400">Uses hub location settings (latitude, longitude, timezone).</p>
              )}

              {formValues.scheduleMode === 'astro_offset' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span>Sunset Offset (minutes)</span>
                      <input type="number" className={sharedInputClass} value={formValues.sunsetOffsetMinutes} onChange={(e) => setFormValues((v) => ({ ...v, sunsetOffsetMinutes: Number(e.target.value) }))} />
                    </label>
                    <label>
                      <span>Sunrise Offset (minutes)</span>
                      <input type="number" className={sharedInputClass} value={formValues.sunriseOffsetMinutes} onChange={(e) => setFormValues((v) => ({ ...v, sunriseOffsetMinutes: Number(e.target.value) }))} />
                    </label>
                  </div>
                  <p className="text-xs text-slate-400">Uses hub location settings (latitude, longitude, timezone).</p>
                </>
              )}
            </Section>

            <Section title="Operations Controls">
              <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-300">Test Mode</p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={formValues.testModeEnabled} onChange={(e) => setFormValues((v) => ({ ...v, testModeEnabled: e.target.checked }))} />
                  <InfoLabel label="Bypass schedule restrictions" helpText="Temporarily bypasses scheduling restrictions. Useful during installation and testing." />
                </label>
              </div>

              <div className="rounded border border-sky-700/40 bg-sky-950/20 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-300">Manual Override</p>
                <label>
                  <InfoLabel label="Manual Override Mode" helpText={'Forces behavior regardless of automation:\n- force_on: always on\n- force_off: never activates\n- suspended: ignores automation temporarily'} />
                  <select className={sharedInputClass} value={formValues.manualOverrideMode} onChange={(e) => setFormValues((v) => ({ ...v, manualOverrideMode: e.target.value as ManualOverrideMode }))}>
                    <option value="none">none</option>
                    <option value="force_on">force_on</option>
                    <option value="force_off">force_off</option>
                    <option value="suspended">suspended</option>
                  </select>
                </label>
              </div>
            </Section>

            <details className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-white">Advanced / Debug Only — not required for normal setup</summary>
              <div className="mt-3 space-y-2">
                <label>
                  <span>Advanced / Debug Only</span>
                  <textarea className="mt-1 h-24 w-full rounded bg-slate-800 px-2 py-1 font-mono text-xs" value={formValues.advancedScheduleJson} onChange={(e) => setFormValues((v) => ({ ...v, advancedScheduleJson: e.target.value }))} />
                </label>
              </div>
            </details>

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
