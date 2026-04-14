import type { ChangeEvent } from 'react';

type AstroSettingsCardProps = {
  timezone: string;
  latitude: string;
  longitude: string;
  astroEnabled: boolean;
  timezoneError?: string;
  latitudeError?: string;
  longitudeError?: string;
  timezoneOptions: string[];
  astroPreview:
    | { status: 'ready'; sunrise: string; sunset: string }
    | { status: 'incomplete' | 'invalid'; message: string };
  onChange: (field: 'timezone' | 'latitude' | 'longitude' | 'astroEnabled', value: string | boolean) => void;
};

function readinessLabel(timezone: string, latitude: string, longitude: string): {
  text: string;
  className: string;
} {
  const isReady = timezone.trim().length > 0 && latitude.trim().length > 0 && longitude.trim().length > 0;

  if (isReady) {
    return {
      text: 'Astro scheduling ready',
      className: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
    };
  }

  return {
    text: 'Astro scheduling incomplete',
    className: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
  };
}

function onTextChange(
  event: ChangeEvent<HTMLInputElement>,
  field: 'timezone' | 'latitude' | 'longitude',
  onChange: AstroSettingsCardProps['onChange'],
) {
  onChange(field, event.target.value);
}

export function AstroSettingsCard({
  timezone,
  latitude,
  longitude,
  astroEnabled,
  timezoneError,
  latitudeError,
  longitudeError,
  timezoneOptions,
  astroPreview,
  onChange,
}: AstroSettingsCardProps) {
  const readiness = readinessLabel(timezone, latitude, longitude);

  return (
    <section className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Astro / Location Settings</h2>
          <p className="text-sm text-slate-400">
            Sunset-to-sunrise and astro-offset schedules require the hub timezone and location to be configured.
          </p>
        </div>
        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${readiness.className}`}>
          {readiness.text}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm text-slate-200">
          Timezone
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-2"
            value={timezone}
            onChange={(event) => onTextChange(event, 'timezone', onChange)}
            placeholder="UTC or America/Chicago"
            list="timezone-options"
          />
          <datalist id="timezone-options">
            {timezoneOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <p className="mt-1 text-xs text-slate-400">Search or select an IANA timezone (for example: America/Los_Angeles).</p>
          {timezoneError ? <p className="mt-1 text-xs text-rose-300">{timezoneError}</p> : null}
        </label>

        <label className="inline-flex items-center gap-2 self-start rounded border border-slate-700 px-3 py-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={astroEnabled}
            onChange={(event) => onChange('astroEnabled', event.target.checked)}
          />
          Enable sunset/sunrise scheduling
        </label>

        <label className="text-sm text-slate-200">
          Latitude
          <input
            type="number"
            step="any"
            min={-90}
            max={90}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-2"
            value={latitude}
            onChange={(event) => onTextChange(event, 'latitude', onChange)}
            placeholder="37.7749"
          />
          <p className="mt-1 text-xs text-slate-400">Valid range is -90 to 90.</p>
          {latitudeError ? <p className="mt-1 text-xs text-rose-300">{latitudeError}</p> : null}
        </label>

        <label className="text-sm text-slate-200">
          Longitude
          <input
            type="number"
            step="any"
            min={-180}
            max={180}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-2"
            value={longitude}
            onChange={(event) => onTextChange(event, 'longitude', onChange)}
            placeholder="-122.4194"
          />
          <p className="mt-1 text-xs text-slate-400">Valid range is -180 to 180.</p>
          {longitudeError ? <p className="mt-1 text-xs text-rose-300">{longitudeError}</p> : null}
        </label>
      </div>

      <div className="mt-4 rounded-md border border-slate-700 bg-slate-950/60 p-3">
        <h3 className="text-sm font-semibold text-white">Today&apos;s Astro Times</h3>
        {astroPreview.status === 'ready' ? (
          <dl className="mt-2 grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Today&apos;s Sunrise</dt>
              <dd>{astroPreview.sunrise}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Today&apos;s Sunset</dt>
              <dd>{astroPreview.sunset}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-amber-300">{astroPreview.message}</p>
        )}
      </div>
    </section>
  );
}
