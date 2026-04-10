import { and, desc, eq } from 'drizzle-orm';
import SunCalc from 'suncalc';
import { DateTime } from 'luxon';
import { db } from '../../db/client.js';
import { eventLogs, floodlights, groups, hubSettings } from '../../db/schema.js';

type PolicyDecision = { accepted: boolean; reason: string };
type TargetType = 'group' | 'floodlight';

type PolicyTarget = {
  id: number;
  automationEnabled: boolean;
  scheduleMode: string;
  scheduleJson: string;
  debounceSeconds: number;
  cooldownSeconds: number;
  testModeEnabled: boolean;
  testModeUntil: string | null;
  manualOverrideMode?: string;
};

function parseSchedule(scheduleJson: string): Record<string, unknown> {
  try {
    return JSON.parse(scheduleJson);
  } catch {
    return {};
  }
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function fixedWindowAllowed(now: DateTime, start: string, end: string): boolean {
  const current = now.hour * 60 + now.minute;
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s <= e) return current >= s && current <= e;
  return current >= s || current <= e;
}

function isTestModeActive(enabled: boolean, until?: string | null): boolean {
  if (!enabled) return false;
  if (!until) return true;
  const dt = DateTime.fromISO(until);
  return dt.isValid && dt >= DateTime.utc();
}

function astroAllowed(mode: string, schedule: Record<string, unknown>, settings: typeof hubSettings.$inferSelect): boolean {
  if (!settings.astroEnabled || !settings.latitude || !settings.longitude) {
    return false;
  }
  const now = DateTime.now().setZone(settings.timezone);
  const times = SunCalc.getTimes(now.toJSDate(), Number(settings.latitude), Number(settings.longitude));
  const sunset = DateTime.fromJSDate(times.sunset).setZone(settings.timezone);
  const sunrise = DateTime.fromJSDate(times.sunrise).setZone(settings.timezone);

  if (mode === 'sunset_to_sunrise') {
    return now >= sunset || now <= sunrise;
  }

  const startOffsetMin = Number(schedule.startOffsetMinutes ?? -30);
  const endOffsetMin = Number(schedule.endOffsetMinutes ?? 30);
  const start = sunset.plus({ minutes: startOffsetMin });
  const end = sunrise.plus({ minutes: endOffsetMin });
  return now >= start || now <= end;
}

async function evaluateCore(targetType: TargetType, target: PolicyTarget): Promise<PolicyDecision> {
  if (!target.automationEnabled) return { accepted: false, reason: 'rejected_disabled' };
  if (targetType === 'floodlight' && (target.manualOverrideMode === 'force_off' || target.manualOverrideMode === 'suspended')) {
    return { accepted: false, reason: 'rejected_override' };
  }

  const settings = (await db.query.hubSettings.findFirst({ where: eq(hubSettings.id, 1) })) ?? {
    id: 1,
    timezone: 'UTC',
    latitude: null,
    longitude: null,
    astroEnabled: false,
    defaultWebhookHeaderName: 'X-Widgets-Secret',
    uiSessionTimeoutMinutes: 60,
    logRetentionDays: 30,
    createdAt: '',
    updatedAt: ''
  };

  const now = DateTime.now().setZone(settings.timezone);
  const schedule = parseSchedule(target.scheduleJson);
  const testMode = isTestModeActive(target.testModeEnabled, target.testModeUntil);

  if (!testMode) {
    if (target.scheduleMode === 'fixed_window') {
      const start = String(schedule.start ?? '00:00');
      const end = String(schedule.end ?? '23:59');
      if (!fixedWindowAllowed(now, start, end)) return { accepted: false, reason: 'rejected_schedule' };
    }

    if (target.scheduleMode === 'sunset_to_sunrise' || target.scheduleMode === 'astro_offset') {
      if (!settings.astroEnabled || !settings.latitude || !settings.longitude) return { accepted: false, reason: 'rejected_schedule_astro_config_missing' };
      if (!astroAllowed(target.scheduleMode, schedule, settings)) return { accepted: false, reason: 'rejected_schedule' };
    }
  }

  const recent = await db
    .select()
    .from(eventLogs)
    .where(and(eq(eventLogs.targetType, targetType), eq(eventLogs.targetId, target.id), eq(eventLogs.decision, 'accepted')))
    .orderBy(desc(eventLogs.createdAt))
    .limit(1);

  if (recent[0]) {
    const last = DateTime.fromISO(recent[0].createdAt);
    const elapsed = now.diff(last, 'seconds').seconds;
    if (target.debounceSeconds > 0 && elapsed < target.debounceSeconds) return { accepted: false, reason: 'rejected_debounce' };
    if (target.cooldownSeconds > 0 && elapsed < target.cooldownSeconds) return { accepted: false, reason: 'rejected_cooldown' };
  }

  return { accepted: true, reason: testMode ? 'accepted_test_mode' : 'accepted' };
}

export async function evaluateGroupPolicy(groupId: number): Promise<PolicyDecision> {
  const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
  if (!group) return { accepted: false, reason: 'group_not_found' };
  return evaluateCore('group', group);
}

export async function evaluateFloodlightPolicy(floodlightId: number): Promise<PolicyDecision> {
  const light = await db.query.floodlights.findFirst({ where: eq(floodlights.id, floodlightId) });
  if (!light) return { accepted: false, reason: 'floodlight_not_found' };
  return evaluateCore('floodlight', light);
}
