import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AxiosError } from 'axios';
import { AstroSettingsCard } from '../components/AstroSettingsCard';
import { HubInfoCard } from '../components/HubInfoCard';
import { WebhookSettingsCard } from '../components/WebhookSettingsCard';
import { useSettings, useSyncProtectSources, useUpdateSettings } from '../hooks/useSettings';
import { getTodaySunriseSunset, listIanaTimezones } from '../utils/astro';

type SettingsFormValues = {
  timezone: string;
  latitude: string;
  longitude: string;
  astroEnabled: boolean;
  defaultWebhookHeaderName: string;
  protectApiEnabled: boolean;
  protectConsoleHost: string;
  protectApiKey: string;
};

type FormErrors = Partial<Record<'timezone' | 'latitude' | 'longitude' | 'defaultWebhookHeaderName' | 'protectConsoleHost', string>>;
type ActionMessage = { type: 'success' | 'error'; text: string } | null;

const defaultValues: SettingsFormValues = {
  timezone: '',
  latitude: '',
  longitude: '',
  astroEnabled: false,
  defaultWebhookHeaderName: 'X-Widgets-Secret',
  protectApiEnabled: false,
  protectConsoleHost: '',
  protectApiKey: '',
};

function getErrorMessage(error: unknown): string {
  const axiosError = error as AxiosError<{ message?: string; error?: string }>;
  return (
    axiosError.response?.data?.message ??
    axiosError.response?.data?.error ??
    (error instanceof Error ? error.message : 'Unknown error')
  );
}

function validate(values: SettingsFormValues): FormErrors {
  const errors: FormErrors = {};

  if (!values.timezone.trim()) {
    errors.timezone = 'Timezone is required for astro scheduling.';
  }

  const latitude = Number(values.latitude);
  if (!values.latitude.trim()) {
    errors.latitude = 'Latitude is required.';
  } else if (Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
    errors.latitude = 'Latitude must be a number between -90 and 90.';
  }

  const longitude = Number(values.longitude);
  if (!values.longitude.trim()) {
    errors.longitude = 'Longitude is required.';
  } else if (Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
    errors.longitude = 'Longitude must be a number between -180 and 180.';
  }

  if (!values.defaultWebhookHeaderName.trim()) {
    errors.defaultWebhookHeaderName = 'Webhook header name cannot be blank.';
  }

  if (values.protectApiEnabled && !values.protectConsoleHost.trim()) {
    errors.protectConsoleHost = 'Protect Console IP / Host is required when Protect API integration is enabled.';
  }

  return errors;
}

export function SettingsPage() {
  const settingsQuery = useSettings();
  const updateMutation = useUpdateSettings();
  const syncMutation = useSyncProtectSources();
  const [formValues, setFormValues] = useState<SettingsFormValues>(defaultValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [actionMessage, setActionMessage] = useState<ActionMessage>(null);

  useEffect(() => {
    if (!settingsQuery.data) return;

    setFormValues({
      timezone: settingsQuery.data.timezone ?? '',
      latitude: settingsQuery.data.latitude ?? '',
      longitude: settingsQuery.data.longitude ?? '',
      astroEnabled: settingsQuery.data.astroEnabled,
      defaultWebhookHeaderName: settingsQuery.data.defaultWebhookHeaderName,
      protectApiEnabled: settingsQuery.data.protectApiEnabled,
      protectConsoleHost: settingsQuery.data.protectConsoleHost ?? '',
      protectApiKey: '',
    });
  }, [settingsQuery.data]);

  useEffect(() => {
    if (!actionMessage || typeof window === 'undefined') return;
    const timeout = window.setTimeout(() => setActionMessage(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [actionMessage]);

  const isDirty = useMemo(() => {
    if (!settingsQuery.data) return false;

    return (
      formValues.timezone !== (settingsQuery.data.timezone ?? '') ||
      formValues.latitude !== (settingsQuery.data.latitude ?? '') ||
      formValues.longitude !== (settingsQuery.data.longitude ?? '') ||
      formValues.astroEnabled !== settingsQuery.data.astroEnabled ||
      formValues.defaultWebhookHeaderName !== settingsQuery.data.defaultWebhookHeaderName ||
      formValues.protectApiEnabled !== settingsQuery.data.protectApiEnabled ||
      formValues.protectConsoleHost !== (settingsQuery.data.protectConsoleHost ?? '') ||
      !!formValues.protectApiKey.trim()
    );
  }, [formValues, settingsQuery.data]);

  const timezoneOptions = useMemo(() => listIanaTimezones(), []);
  const astroPreview = useMemo(
    () => getTodaySunriseSunset(formValues.timezone, formValues.latitude, formValues.longitude),
    [formValues.timezone, formValues.latitude, formValues.longitude],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validate(formValues);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setActionMessage({ type: 'error', text: 'Please correct the highlighted settings before saving.' });
      return;
    }

    try {
      await updateMutation.mutateAsync({
        timezone: formValues.timezone.trim(),
        latitude: formValues.latitude.trim(),
        longitude: formValues.longitude.trim(),
        astroEnabled: formValues.astroEnabled,
        defaultWebhookHeaderName: formValues.defaultWebhookHeaderName.trim(),
        protectApiEnabled: formValues.protectApiEnabled,
        protectConsoleHost: formValues.protectConsoleHost.trim() || null,
        ...(formValues.protectApiKey.trim() ? { protectApiKey: formValues.protectApiKey.trim() } : {}),
      });
      setFormValues((current) => ({ ...current, protectApiKey: '' }));
      setActionMessage({ type: 'success', text: 'Hub settings saved successfully.' });
    } catch (error) {
      setActionMessage({ type: 'error', text: `Failed to save hub settings: ${getErrorMessage(error)}` });
    }
  }

  async function onSaveProtectSettings() {
    const nextErrors: FormErrors = {};
    if (formValues.protectApiEnabled && !formValues.protectConsoleHost.trim()) {
      nextErrors.protectConsoleHost = 'Protect Console IP / Host is required when Protect API integration is enabled.';
    }

    setErrors((current) => ({ ...current, protectConsoleHost: nextErrors.protectConsoleHost }));
    if (nextErrors.protectConsoleHost) {
      setActionMessage({ type: 'error', text: 'Please correct the highlighted Protect settings before saving.' });
      return;
    }

    try {
      await updateMutation.mutateAsync({
        protectApiEnabled: formValues.protectApiEnabled,
        protectConsoleHost: formValues.protectConsoleHost.trim() || null,
        ...(formValues.protectApiKey.trim() ? { protectApiKey: formValues.protectApiKey.trim() } : {}),
      });
      setFormValues((current) => ({ ...current, protectApiKey: '' }));
      setActionMessage({ type: 'success', text: 'Protect settings saved successfully.' });
    } catch (error) {
      setActionMessage({ type: 'error', text: `Failed to save Protect settings: ${getErrorMessage(error)}` });
    }
  }

  async function onSyncProtectSources() {
    try {
      const result = await syncMutation.mutateAsync();
      const total = result.totalKnownSources;
      setActionMessage({
        type: 'success',
        text: typeof total === 'number' ? `Protect sources synced. ${total} source${total === 1 ? '' : 's'} known.` : 'Protect sources synced.',
      });
    } catch (error) {
      setActionMessage({ type: 'error', text: `Failed to sync Protect sources: ${getErrorMessage(error)}` });
    }
  }

  if (settingsQuery.isLoading) {
    return <p className="text-sm text-slate-300">Loading settings…</p>;
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <p className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
        Unable to load settings: {getErrorMessage(settingsQuery.error)}
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-white">Hub Settings</h1>
        <p className="text-sm text-slate-400">Configure hub-level options used by astro schedules and webhook authentication.</p>
      </header>

      <form className="space-y-4" onSubmit={onSubmit}>
        <AstroSettingsCard
          timezone={formValues.timezone}
          latitude={formValues.latitude}
          longitude={formValues.longitude}
          astroEnabled={formValues.astroEnabled}
          timezoneError={errors.timezone}
          latitudeError={errors.latitude}
          longitudeError={errors.longitude}
          timezoneOptions={timezoneOptions}
          astroPreview={astroPreview}
          onChange={(field, value) => {
            setErrors((current) => ({ ...current, [field]: undefined }));
            setFormValues((current) => ({ ...current, [field]: value }));
          }}
        />

        <WebhookSettingsCard
          defaultWebhookHeaderName={formValues.defaultWebhookHeaderName}
          headerNameError={errors.defaultWebhookHeaderName}
          onHeaderNameChange={(value) => {
            setErrors((current) => ({ ...current, defaultWebhookHeaderName: undefined }));
            setFormValues((current) => ({ ...current, defaultWebhookHeaderName: value }));
          }}
        />

        <section className="rounded border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white">UniFi Protect API Integration</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex items-start gap-3 rounded border border-slate-800 bg-slate-950/50 p-3 md:col-span-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={formValues.protectApiEnabled}
                onChange={(event) => setFormValues((current) => ({ ...current, protectApiEnabled: event.target.checked }))}
              />
              <span>
                <span className="block text-sm font-semibold text-slate-100">Enable Protect API Integration</span>
                <span className="mt-1 block text-xs text-slate-400">
                  When enabled, the hub connects to the UniFi Protect API event stream and publishes normalized events into the shared routing pipeline.
                </span>
              </span>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Protect Console IP / Host</span>
              <input
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                value={formValues.protectConsoleHost}
                onChange={(event) => {
                  setErrors((current) => ({ ...current, protectConsoleHost: undefined }));
                  setFormValues((current) => ({ ...current, protectConsoleHost: event.target.value }));
                }}
                placeholder="10.0.30.1"
              />
              <span className="block text-xs text-slate-400">IP address or hostname of the UniFi OS console running Protect.</span>
              {errors.protectConsoleHost ? <span className="block text-xs text-rose-300">{errors.protectConsoleHost}</span> : null}
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Protect API Key</span>
              <input
                type="password"
                autoComplete="new-password"
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                value={formValues.protectApiKey}
                onChange={(event) => setFormValues((current) => ({ ...current, protectApiKey: event.target.value }))}
                placeholder={settingsQuery.data.hasProtectApiKey ? 'Existing key saved' : ''}
              />
              <span className="block text-xs text-slate-400">
                Create this API key in UniFi Protect / UniFi OS integration settings. It is sent as the X-API-KEY header.
              </span>
              <span className="block text-xs text-slate-500">Leave blank to preserve the existing key.</span>
            </label>

            <div className="flex flex-wrap items-start gap-3 md:col-span-2">
              <button
                type="button"
                disabled={updateMutation.isPending || !isDirty}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-700"
                onClick={() => void onSaveProtectSettings()}
              >
                {updateMutation.isPending ? 'Saving…' : 'Save Protect Settings'}
              </button>
              <div>
                <button
                  type="button"
                  disabled={syncMutation.isPending}
                  className="rounded border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                  onClick={() => void onSyncProtectSources()}
                >
                  {syncMutation.isPending ? 'Syncing…' : 'Sync Protect Sources'}
                </button>
                <p className="mt-1 text-xs text-slate-400">Fetches cameras from Protect and updates the local Protect source inventory used by Event Routes.</p>
              </div>
            </div>
          </div>
        </section>

        <HubInfoCard settings={settingsQuery.data} />

        {actionMessage ? (
          <p
            className={`rounded border px-3 py-2 text-sm ${
              actionMessage.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
            }`}
          >
            {actionMessage.text}
          </p>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={updateMutation.isPending || !isDirty}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {updateMutation.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </section>
  );
}
