type AstroTimesResult =
  | { status: 'ready'; sunrise: string; sunset: string }
  | { status: 'incomplete'; message: string }
  | { status: 'invalid'; message: string };

const ZENITH = 90.833;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function normalizeRange(value: number, max: number): number {
  const next = value % max;
  return next < 0 ? next + max : next;
}

function dayOfYear(date: Date): number {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const now = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  return Math.floor((now - start) / 86400000) + 1;
}

function calculateSunTimeUtcHours(
  date: Date,
  latitude: number,
  longitude: number,
  event: 'sunrise' | 'sunset',
): number | null {
  const n = dayOfYear(date);
  const lngHour = longitude / 15;
  const t = event === 'sunrise' ? n + (6 - lngHour) / 24 : n + (18 - lngHour) / 24;
  const meanAnomaly = 0.9856 * t - 3.289;
  const trueLongitude =
    normalizeRange(
      meanAnomaly + 1.916 * Math.sin(toRadians(meanAnomaly)) + 0.02 * Math.sin(2 * toRadians(meanAnomaly)) + 282.634,
      360,
    );

  let rightAscension = toDegrees(Math.atan(0.91764 * Math.tan(toRadians(trueLongitude))));
  rightAscension = normalizeRange(rightAscension, 360);
  const lQuadrant = Math.floor(trueLongitude / 90) * 90;
  const raQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + (lQuadrant - raQuadrant)) / 15;

  const sinDeclination = 0.39782 * Math.sin(toRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosH =
    (Math.cos(toRadians(ZENITH)) - sinDeclination * Math.sin(toRadians(latitude))) /
    (cosDeclination * Math.cos(toRadians(latitude)));

  if (cosH < -1 || cosH > 1) {
    return null;
  }

  let h =
    event === 'sunrise'
      ? 360 - toDegrees(Math.acos(cosH))
      : toDegrees(Math.acos(cosH));
  h = h / 15;

  const localMeanTime = h + rightAscension - 0.06571 * t - 6.622;
  return normalizeRange(localMeanTime - lngHour, 24);
}

function formatInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(date);
}

export function getTodaySunriseSunset(
  timezone: string,
  latitudeInput: string,
  longitudeInput: string,
): AstroTimesResult {
  const latitude = Number(latitudeInput);
  const longitude = Number(longitudeInput);

  if (!timezone.trim() || !latitudeInput.trim() || !longitudeInput.trim()) {
    return { status: 'incomplete', message: 'Configure timezone, latitude, and longitude to preview sunrise/sunset.' };
  }

  if (Number.isNaN(latitude) || Number.isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { status: 'invalid', message: 'Sunrise/sunset unavailable: latitude or longitude is out of range.' };
  }

  try {
    const now = new Date();
    const sunriseHours = calculateSunTimeUtcHours(now, latitude, longitude, 'sunrise');
    const sunsetHours = calculateSunTimeUtcHours(now, latitude, longitude, 'sunset');
    if (sunriseHours === null || sunsetHours === null) {
      return { status: 'invalid', message: 'Sunrise/sunset unavailable for this location and date.' };
    }

    const startOfDayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const sunriseDate = new Date(startOfDayUtc + sunriseHours * 3600000);
    const sunsetDate = new Date(startOfDayUtc + sunsetHours * 3600000);

    return {
      status: 'ready',
      sunrise: formatInTimezone(sunriseDate, timezone),
      sunset: formatInTimezone(sunsetDate, timezone),
    };
  } catch {
    return { status: 'invalid', message: 'Sunrise/sunset unavailable: timezone is invalid.' };
  }
}

export function listIanaTimezones(): string[] {
  const intlWithSupportedValues = Intl as unknown as {
    supportedValuesOf?: (key: 'timeZone') => string[];
  };

  if (typeof intlWithSupportedValues.supportedValuesOf === 'function') {
    return intlWithSupportedValues.supportedValuesOf('timeZone');
  }

  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
    'America/Anchorage',
    'Pacific/Honolulu',
  ];
}
