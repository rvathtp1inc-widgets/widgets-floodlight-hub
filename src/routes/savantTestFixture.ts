import { Server as HttpsServer } from 'node:https';
import Fastify, { FastifyHttpsOptions, FastifyInstance } from 'fastify';

export type SavantTestZoneStatus = 'Normal' | 'Violated';

interface FixtureLogger {
  info(fields: Record<string, unknown>): void;
}

interface SavantTestFixtureOptions {
  tls: NonNullable<FastifyHttpsOptions<HttpsServer>['https']>;
  initialZoneStatus?: SavantTestZoneStatus;
  logger?: FixtureLogger;
}

const VALID_ZONE_STATUSES = new Set<SavantTestZoneStatus>(['Normal', 'Violated']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function buildSavantTestFixtureApp(options: SavantTestFixtureOptions): FastifyInstance<HttpsServer> {
  const fastifyOptions: FastifyHttpsOptions<HttpsServer> = {
    https: options.tls,
    logger: false
  };
  const app = Fastify(fastifyOptions);
  const logger = options.logger ?? { info: (fields: Record<string, unknown>) => console.info(fields) };
  let zoneStatus: SavantTestZoneStatus = options.initialZoneStatus ?? 'Normal';

  const log = (event: string, fields: Record<string, unknown> = {}) => {
    logger.info({ timestamp: new Date().toISOString(), event, ...fields });
  };

  log('current test fixture state', { zoneStatus });

  app.post('/', async (request, reply) => {
    const body = request.body;
    const requestedMethod = isRecord(body) ? body.method : undefined;
    const requestedZone = isRecord(body) ? body.zone : undefined;

    log('request received', {
      requestedMethod: requestedMethod ?? null,
      requestedZone: requestedZone ?? null
    });

    if (requestedMethod !== 'queryZoneStatus' || requestedZone !== 1) {
      log('validation failure', {
        requestedMethod: requestedMethod ?? null,
        requestedZone: requestedZone ?? null
      });
      return reply.code(400).send({ error: 'invalid_request' });
    }

    log('zone status returned', {
      requestedMethod,
      requestedZone,
      zoneStatus
    });
    return {
      result: {
        zoneNumber: 1,
        zoneLabel: 'Widgets Test Zone 1',
        zoneStatus
      }
    };
  });

  app.post('/test/savant-zone/1', async (request, reply) => {
    const body = request.body;
    const requestedStatus = isRecord(body) ? body.zoneStatus : undefined;

    log('request received', {
      requestedMethod: 'setZoneStatus',
      requestedZone: 1
    });

    if (typeof requestedStatus !== 'string' || !VALID_ZONE_STATUSES.has(requestedStatus as SavantTestZoneStatus)) {
      log('validation failure', {
        requestedMethod: 'setZoneStatus',
        requestedZone: 1
      });
      return reply.code(400).send({ error: 'invalid_zone_status' });
    }

    zoneStatus = requestedStatus as SavantTestZoneStatus;
    log('current test fixture state', { zoneStatus });
    return { zoneNumber: 1, zoneStatus };
  });

  return app;
}
