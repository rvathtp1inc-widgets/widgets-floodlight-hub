import net, { AddressInfo, Server, Socket } from 'node:net';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import {
  buildElkZoneChangeFrame
} from './services/virtualSecurityPanel/buildElkZoneChangeFrame.js';
import type { VirtualSecurityDesiredState } from './services/virtualSecurityPanel/types.js';

export const SAVANT_TCP_TEST_ZONES = [1, 4, 12, 37, 128] as const;

type SendReason =
  | 'manual state change'
  | 'initial synchronization'
  | 'reconnect synchronization'
  | 'manual resync';

interface FixtureLogger {
  info(fields: Record<string, unknown>): void;
}

interface SavantTcpTestFixtureOptions {
  host?: string;
  port?: number;
  initialZoneStates?: ReadonlyMap<number, VirtualSecurityDesiredState>;
  logger?: FixtureLogger;
}

function remoteAddress(socket: Socket): string {
  return `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 'unknown'}`;
}

function isConfiguredZone(zoneNumber: number): boolean {
  return SAVANT_TCP_TEST_ZONES.some((configuredZone) => configuredZone === zoneNumber);
}

function parseZoneNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const zoneNumber = Number(value);
  return Number.isInteger(zoneNumber) && isConfiguredZone(zoneNumber) ? zoneNumber : null;
}

export class SavantTcpTestFixtureServer {
  private readonly server: Server;
  private readonly host: string;
  private readonly port: number;
  private readonly logger: FixtureLogger;
  private readonly zoneStates = new Map<number, VirtualSecurityDesiredState>();
  private client: Socket | null = null;
  private hasAcceptedClient = false;

  constructor(options: SavantTcpTestFixtureOptions = {}) {
    this.host = options.host ?? '0.0.0.0';
    this.port = options.port ?? 2101;
    this.logger = options.logger ?? { info: (fields: Record<string, unknown>) => console.info(fields) };

    for (const zoneNumber of SAVANT_TCP_TEST_ZONES) {
      const state = options.initialZoneStates?.get(zoneNumber) ?? 'Normal';
      if (state !== 'Normal' && state !== 'Violated') {
        throw new Error(`Invalid initial state for Zone ${zoneNumber}.`);
      }
      this.zoneStates.set(zoneNumber, state);
    }

    this.server = net.createServer((socket) => this.acceptClient(socket));
  }

  private log(event: string, fields: Record<string, unknown> = {}): void {
    this.logger.info({ timestamp: new Date().toISOString(), event, ...fields });
  }

  private acceptClient(socket: Socket): void {
    if (this.client) this.client.destroy();

    this.client = socket;
    const address = remoteAddress(socket);
    const reason: SendReason = this.hasAcceptedClient
      ? 'reconnect synchronization'
      : 'initial synchronization';
    this.hasAcceptedClient = true;
    this.log('client connected', { clientRemoteAddress: address });

    socket.once('close', () => {
      if (this.client === socket) this.client = null;
      this.log('client disconnected', { clientRemoteAddress: address });
    });
    socket.on('error', () => undefined);
    this.sendAllZones(reason);
  }

  private sendZone(zoneNumber: number, reason: SendReason): boolean {
    const state = this.zoneStates.get(zoneNumber);
    if (!state) throw new Error(`Zone ${zoneNumber} is not configured.`);

    const frame = buildElkZoneChangeFrame(zoneNumber, state);
    const frameDetails = {
      zoneNumber,
      state,
      escapedFrame: frame.toString('ascii').replace('\r', '\\r').replace('\n', '\\n'),
      hexadecimalBytes: frame.toString('hex').match(/../g)?.join(' ') ?? '',
      reason
    };

    if (!this.client || this.client.destroyed) {
      this.log('send failed', { ...frameDetails, sendResult: 'no client connected' });
      return false;
    }

    this.client.write(frame, (error) => {
      this.log(error ? 'send failed' : 'send succeeded', {
        ...frameDetails,
        sendResult: error ? 'failed' : 'succeeded'
      });
    });
    return true;
  }

  private sendAllZones(reason: SendReason): void {
    for (const zoneNumber of SAVANT_TCP_TEST_ZONES) {
      this.sendZone(zoneNumber, reason);
    }
  }

  private logAllStates(): void {
    this.log('current zone states', {
      zones: SAVANT_TCP_TEST_ZONES.map((zoneNumber) => ({
        zoneNumber,
        state: this.zoneStates.get(zoneNumber)
      }))
    });
  }

  async start(): Promise<AddressInfo> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen({ host: this.host, port: this.port }, () => {
        this.server.off('error', reject);
        resolve();
      });
    });

    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('TCP fixture did not bind to an IP address.');
    }
    this.log('server listening address', { listeningAddress: `${address.address}:${address.port}` });
    this.logAllStates();
    return address;
  }

  command(command: string): boolean {
    const parts = command.trim().split(/\s+/);
    const action = parts[0]?.toLowerCase();

    if (action === 'set' && parts.length === 3) {
      const zoneNumber = parseZoneNumber(parts[1]);
      const requestedState = parts[2].toLowerCase();
      if (zoneNumber !== null && (requestedState === 'normal' || requestedState === 'violated')) {
        const state: VirtualSecurityDesiredState = requestedState === 'normal' ? 'Normal' : 'Violated';
        this.zoneStates.set(zoneNumber, state);
        this.log('current zone state', { zoneNumber, state });
        this.sendZone(zoneNumber, 'manual state change');
        return true;
      }
    }

    if (action === 'status' && parts.length === 1) {
      this.logAllStates();
      return true;
    }

    if (action === 'status' && parts.length === 2) {
      const zoneNumber = parseZoneNumber(parts[1]);
      if (zoneNumber !== null) {
        this.log('current zone state', { zoneNumber, state: this.zoneStates.get(zoneNumber) });
        return true;
      }
    }

    if (action === 'clients' && parts.length === 1) {
      this.log('client status', {
        clientRemoteAddress: this.client ? remoteAddress(this.client) : null
      });
      return true;
    }

    if (action === 'resync' && parts.length === 1) {
      this.sendAllZones('manual resync');
      return true;
    }

    this.log('command rejected');
    return false;
  }

  currentStates(): ReadonlyMap<number, VirtualSecurityDesiredState> {
    return new Map(this.zoneStates);
  }

  activeClientCount(): number {
    return this.client && !this.client.destroyed ? 1 : 0;
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    client?.destroy();
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function run(): Promise<void> {
  const configuredPort = process.env.SAVANT_TCP_TEST_PORT ?? '2101';
  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SAVANT_TCP_TEST_PORT must be an integer from 1 through 65535.');
  }

  const fixture = new SavantTcpTestFixtureServer({
    host: process.env.SAVANT_TCP_TEST_HOST?.trim() || '0.0.0.0',
    port
  });
  const terminal = readline.createInterface({ input: process.stdin, terminal: true });
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    terminal.close();
    await fixture.close();
  };

  terminal.on('line', (line) => {
    if (line.trim().toLowerCase() === 'quit') {
      void close();
      return;
    }
    fixture.command(line);
  });
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  await fixture.start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
