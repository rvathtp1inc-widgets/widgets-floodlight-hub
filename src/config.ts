import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? './data/widgets-hub.db',
  encryptionKey: process.env.APP_ENCRYPTION_KEY ?? 'dev-only-key-change-me',
  timerPollSeconds: Number(process.env.TIMER_POLL_SECONDS ?? 5),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 5000)
};
