import { eq } from 'drizzle-orm';
import { db } from './client.js';
import { hubSettings } from './schema.js';

async function run() {
  const existing = await db.select().from(hubSettings).where(eq(hubSettings.id, 1));
  if (existing.length === 0) {
    await db.insert(hubSettings).values({ id: 1, timezone: 'UTC', astroEnabled: false, defaultWebhookHeaderName: 'X-Widgets-Secret' });
    console.log('Seeded hub settings row');
  } else {
    console.log('Hub settings already present');
  }
}

run();
