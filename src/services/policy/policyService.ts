import { and, desc, eq } from 'drizzle-orm';
import SunCalc from 'suncalc';
import { DateTime } from 'luxon';
import { db } from '../../db/client.js';
import { eventLogs, floodlights, groups, hubSettings } from '../../db/schema.js';

type PolicyDecision = { accepted: boolean; reason: string };

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

export async function evaluateGroupPolicy(groupId: number): Promise<PolicyDecision> {
  const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
  if (!group) return { accepted: false, reason: 'group_not_found' };
  if (!group.automationEnabled) return { accepted: false, reason: 'group_automation_disabled' };

  const nowUtc = DateTime.utc();
  if (group.testModeEnabled && (!group.testModeUntil || nowUtc <= DateTime.fromISO(group.testModeUntil))) {
    return { accepted: true, reason: 'accepted_test_mode' };
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
  const schedule = parseSchedule(group.scheduleJson);
  if (group.scheduleMode === 'fixed_window') {
    const start = String(schedule.start ?? '00:00');
    const end = String(schedule.end ?? '23:59');
    if (!fixedWindowAllowed(now, start, end)) return { accepted: false, reason: 'outside_fixed_window' };
  }

  if (group.scheduleMode === 'sunset_to_sunrise' || group.scheduleMode === 'astro_offset') {
    if (!settings.astroEnabled || !settings.latitude || !settings.longitude) return { accepted: false, reason: 'astro_config_missing' };
    if (!astroAllowed(group.scheduleMode, schedule, settings)) return { accepted: false, reason: 'outside_astro_window' };
  }

  const recent = await db
    .select()
    .from(eventLogs)
    .where(and(eq(eventLogs.targetType, 'group'), eq(eventLogs.targetId, group.id), eq(eventLogs.decision, 'accepted')))
    .orderBy(desc(eventLogs.createdAt))
    .limit(1);

  if (recent[0]) {
    const last = DateTime.fromISO(recent[0].createdAt);
    const elapsed = now.diff(last, 'seconds').seconds;
    if (group.debounceSeconds > 0 && elapsed < group.debounceSeconds) return { accepted: false, reason: 'debounce_violation' };
    if (group.cooldownSeconds > 0 && elapsed < group.cooldownSeconds) return { accepted: false, reason: 'cooldown_violation' };
  }

  return { accepted: true, reason: 'accepted' };
}

export async function evaluateFloodlightPolicy(floodlightId: number): Promise<PolicyDecision> {
  const light = await db.query.floodlights.findFirst({ where: eq(floodlights.id, floodlightId) });
  if (!light) return { accepted: false, reason: 'floodlight_not_found' };
  if (!light.automationEnabled) return { accepted: false, reason: 'floodlight_automation_disabled' };

  const nowUtc = DateTime.utc();
  if (light.testModeEnabled && (!light.testModeUntil || nowUtc <= DateTime.fromISO(light.testModeUntil))) {
    return { accepted: true, reason: 'accepted_test_mode' };
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
  const schedule = parseSchedule(light.scheduleJson);
  if (light.scheduleMode === 'fixed_window') {
    const start = String(schedule.start ?? '00:00');
    const end = String(schedule.end ?? '23:59');
    if (!fixedWindowAllowed(now, start, end)) return { accepted: false, reason: 'outside_fixed_window' };
  }

  if (light.scheduleMode === 'sunset_to_sunrise' || light.scheduleMode === 'astro_offset') {
    if (!settings.astroEnabled || !settings.latitude || !settings.longitude) return { accepted: false, reason: 'astro_config_missing' };
    if (!astroAllowed(light.scheduleMode, schedule, settings)) return { accepted: false, reason: 'outside_astro_window' };
  }

  const recent = await db
    .select()
    .from(eventLogs)
    .where(and(eq(eventLogs.targetType, 'floodlight'), eq(eventLogs.targetId, light.id), eq(eventLogs.decision, 'accepted')))
    .orderBy(desc(eventLogs.createdAt))
    .limit(1);

  if (recent[0]) {
    const last = DateTime.fromISO(recent[0].createdAt);
    const elapsed = now.diff(last, 'seconds').seconds;
    if (light.debounceSeconds > 0 && elapsed < light.debounceSeconds) return { accepted: false, reason: 'debounce_violation' };
    if (light.cooldownSeconds > 0 && elapsed < light.cooldownSeconds) return { accepted: false, reason: 'cooldown_violation' };
  }

  return { accepted: true, reason: 'accepted' };
}
