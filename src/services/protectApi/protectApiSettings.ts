import { eq } from 'drizzle-orm';
import { ProtectApiConfig } from '../../config.js';
import { db } from '../../db/client.js';
import { hubSettings } from '../../db/schema.js';
import { decryptString } from '../../lib/secrets.js';

function buildProtectBaseUrl(host: string | null | undefined): string {
  const trimmed = host?.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export async function loadPersistedProtectApiConfig(): Promise<ProtectApiConfig> {
  const settings = await db.query.hubSettings.findFirst({ where: eq(hubSettings.id, 1) });
  if (!settings) {
    return { enabled: false, baseUrl: '', apiKey: '' };
  }

  return {
    enabled: settings.protectApiEnabled,
    baseUrl: buildProtectBaseUrl(settings.protectConsoleHost),
    apiKey: decryptString(settings.protectApiKeyEncrypted) ?? ''
  };
}
