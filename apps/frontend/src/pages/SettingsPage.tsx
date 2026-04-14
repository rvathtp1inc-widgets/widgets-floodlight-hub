import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AxiosError } from 'axios';
import { AstroSettingsCard } from '../components/AstroSettingsCard';
import { HubInfoCard } from '../components/HubInfoCard';
import { WebhookSettingsCard } from '../components/WebhookSettingsCard';
import { useSettings, useUpdateSettings } from '../hooks/useSettings';

type SettingsFormValues = {
  timezone: string;
  latitude: string;
  longitude: string;
  astroEnabled: boolean;
  defaultWebhookHeaderName: string;
};

type FormErrors = Partial<Record<'timezone' | 'latitude' | 'longitude' | 'defaultWebhookHeaderName', string>>;
type ActionMessage = { type: 'success' | 'error'; text: string } | null;

const defaultValues: SettingsFormValues = {
  timezone: '',
  latitude: '',
  longitude: '',
  astroEnabled: false,
  defaultWebhookHeaderName: 'X-Widgets-Secret',
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

  return errors;
}

export function SettingsPage() {
  const settingsQuery = useSettings();
  const updateMutation = useUpdateSettings();
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
      formValues.defaultWebhookHeaderName !== settingsQuery.data.defaultWebhookHeaderName
    );
  }, [formValues, settingsQuery.data]);

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
      });
      setActionMessage({ type: 'success', text: 'Hub settings saved successfully.' });
    } catch (error) {
      setActionMessage({ type: 'error', text: `Failed to save hub settings: ${getErrorMessage(error)}` });
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
        <h1 className="text-2xl font-bold text-white">Settings</h1>
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
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {updateMutation.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </section>
  );
}
