import net, { AddressInfo, Server, Socket } from 'node:net';
import {
  VirtualSecurityPanelLifecycle,
  VirtualSecurityPanelLogger,
  VirtualSecurityPanelTransportErrorCode,
  VirtualSecurityPanelTransportErrorStatus
} from './types.js';

export interface SavantTcpTransportOptions {
  host?: string;
  port?: number;
  logger: VirtualSecurityPanelLogger;
  frameWriter?: SavantSocketFrameWriter;
  now?: () => string;
}

export interface SavantWritableSocket {
  readonly destroyed: boolean;
  write(frame: Uint8Array, callback: (error?: Error | null) => void): boolean;
  once(event: 'error' | 'close' | 'drain', listener: (...args: unknown[]) => void): this;
  off(event: 'error' | 'close' | 'drain', listener: (...args: unknown[]) => void): this;
}

export type SavantSocketFrameWriter = (
  socket: SavantWritableSocket,
  frame: Buffer,
  onBackpressure?: () => void
) => Promise<void>;

export function writeSavantSocketFrame(
  socket: SavantWritableSocket,
  frame: Buffer,
  onBackpressure?: () => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let callbackComplete = false;
    let drainComplete = true;
    let settled = false;
    const cleanup = () => {
      socket.off('error', onError);
      socket.off('close', onClose);
      socket.off('drain', onDrain);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const finish = () => {
      if (settled || !callbackComplete || !drainComplete) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = (...args: unknown[]) => fail(args[0] instanceof Error ? args[0] : new Error('Savant socket error during write.'));
    const onClose = () => fail(new Error('Savant socket closed during write.'));
    const onDrain = () => { drainComplete = true; finish(); };
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.once('drain', onDrain);
    const accepted = socket.write(frame, (error) => {
      if (error) { fail(error); return; }
      callbackComplete = true;
      finish();
    });
    if (accepted) {
      socket.off('drain', onDrain);
    } else {
      drainComplete = false;
      onBackpressure?.();
    }
    finish();
  });
}

export interface SavantTcpTransportConnectionHandlers {
  connected(connectionId: number): void;
  disconnected(connectionId: number): void;
}

export interface VirtualSecurityPanelTransport {
  setConnectionHandlers(handlers: SavantTcpTransportConnectionHandlers): void;
  getStatus(): {
    lifecycle: VirtualSecurityPanelLifecycle;
    connected: boolean;
    listeningAddress?: string;
    lastClientConnectedAt: string | null;
    lastClientDisconnectedAt: string | null;
    lastTransportError: VirtualSecurityPanelTransportErrorStatus | null;
  };
  start(): Promise<void>;
  stop(): Promise<void>;
  send(frame: Buffer): Promise<{ connectionId: number }>;
  markUnhealthy(): void;
}

export class SavantTcpTransport implements VirtualSecurityPanelTransport {
  private readonly host: string;
  private readonly port: number;
  private readonly logger: VirtualSecurityPanelLogger;
  private server: Server | null = null;
  private client: Socket | null = null;
  private connectionId = 0;
  private lifecycle: VirtualSecurityPanelLifecycle = 'stopped';
  private listeningAddress?: string;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private handlers?: SavantTcpTransportConnectionHandlers;
  private readonly frameWriter: SavantSocketFrameWriter;
  private readonly now: () => string;
  private lastClientConnectedAt: string | null = null;
  private lastClientDisconnectedAt: string | null = null;
  private lastTransportError: VirtualSecurityPanelTransportErrorStatus | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: SavantTcpTransportOptions) {
    this.host = options.host ?? '0.0.0.0';
    this.port = options.port ?? 2101;
    this.logger = options.logger;
    this.frameWriter = options.frameWriter ?? writeSavantSocketFrame;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  setConnectionHandlers(handlers: SavantTcpTransportConnectionHandlers): void {
    this.handlers = handlers;
  }

  getStatus() {
    return {
      lifecycle: this.lifecycle,
      connected: this.client !== null,
      listeningAddress: this.listeningAddress,
      lastClientConnectedAt: this.lastClientConnectedAt,
      lastClientDisconnectedAt: this.lastClientDisconnectedAt,
      lastTransportError: this.lastTransportError ? { ...this.lastTransportError } : null
    };
  }

  private recordError(code: VirtualSecurityPanelTransportErrorCode, message: string): void {
    this.lastTransportError = { timestamp: this.now(), code, message };
  }

  async start(): Promise<void> {
    if (this.lifecycle === 'listening' || this.lifecycle === 'connected') return;
    if (this.startPromise) return this.startPromise;
    this.lifecycle = 'starting';
    this.logger.info({}, 'Virtual Security Panel transport starting.');
    this.startPromise = this.bind().finally(() => { this.startPromise = undefined; });
    return this.startPromise;
  }

  private async bind(): Promise<void> {
    const server = net.createServer((socket) => this.acceptClient(socket));
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen({ host: this.host, port: this.port }, () => {
          server.off('error', onError);
          resolve();
        });
      });
      const address = server.address() as AddressInfo;
      this.listeningAddress = `${address.address}:${address.port}`;
      this.lifecycle = 'listening';
      this.logger.info({ listeningAddress: this.listeningAddress }, 'Virtual Security Panel transport listening.');
    } catch (error) {
      this.lifecycle = 'faulted';
      this.server = null;
      this.recordError('listener_bind_failed', 'Virtual Security Panel listener failed to start.');
      this.logger.error({ err: error }, 'Virtual Security Panel listener bind failed.');
      throw error;
    }
  }

  private acceptClient(socket: Socket): void {
    const previous = this.client;
    if (previous) {
      this.logger.warn({ connectionId: this.connectionId }, 'Savant client replaced.');
      this.lastClientDisconnectedAt = this.now();
      previous.destroy();
    }
    const id = ++this.connectionId;
    this.client = socket;
    this.lifecycle = 'connected';
    this.lastClientConnectedAt = this.now();
    socket.setKeepAlive(true);
    const remoteAddress = `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 'unknown'}`;
    this.logger.info({ connectionId: id, remoteAddress }, 'Savant client connected.');
    socket.on('data', (bytes) => this.logger.debug({ connectionId: id, byteCount: bytes.length }, 'Ignored inbound bytes.'));
    socket.once('close', () => this.handleUnavailable(socket, id, remoteAddress, false));
    socket.once('error', (error) => this.handleUnavailable(socket, id, remoteAddress, true, error));
    this.handlers?.connected(id);
  }

  private handleUnavailable(socket: Socket, id: number, remoteAddress: string, fromError: boolean, error?: Error): void {
    if (this.client !== socket) {
      this.logger.warn({ connectionId: id }, 'Dropped stale socket event.');
      return;
    }
    this.client = null;
    this.lastClientDisconnectedAt = this.now();
    if (this.lifecycle !== 'stopping' && this.lifecycle !== 'stopped') this.lifecycle = 'listening';
    if (fromError) {
      this.recordError('client_socket_error', 'The connected Savant client encountered a transport error.');
      this.logger.error({ connectionId: id, remoteAddress, err: error }, 'Savant socket error.');
    }
    else this.logger.info({ connectionId: id, remoteAddress }, 'Savant client disconnected.');
    this.handlers?.disconnected(id);
  }

  async send(frame: Buffer): Promise<{ connectionId: number }> {
    const socket = this.client;
    const id = this.connectionId;
    if (!socket || socket.destroyed) throw new Error('Savant client is disconnected.');
    const operation = this.writeChain.catch(() => undefined).then(async () => {
      if (this.client !== socket || socket.destroyed) throw new Error('Savant connection changed before write.');
      try {
        await this.frameWriter(socket, frame, () => {
          this.logger.debug({ connectionId: id }, 'Savant socket backpressure waiting for drain.');
        });
      } catch (error) {
        this.recordError('transport_send_failed', 'Failed to write Virtual Security Panel state to the connected client.');
        if (this.client === socket) socket.destroy();
        throw error;
      }
      return { connectionId: id };
    });
    this.writeChain = operation.then(() => undefined, () => undefined);
    return operation;
  }

  markUnhealthy(): void {
    this.client?.destroy();
  }

  async stop(): Promise<void> {
    if (this.lifecycle === 'stopped') return;
    if (this.stopPromise) return this.stopPromise;
    this.lifecycle = 'stopping';
    this.logger.info({}, 'Virtual Security Panel transport stopping.');
    this.stopPromise = this.teardown().finally(() => { this.stopPromise = undefined; });
    return this.stopPromise;
  }

  private async teardown(): Promise<void> {
    const socket = this.client;
    this.client = null;
    socket?.destroy();
    const server = this.server;
    this.server = null;
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    server?.removeAllListeners();
    this.listeningAddress = undefined;
    this.lifecycle = 'stopped';
    this.logger.info({}, 'Virtual Security Panel transport stopped.');
  }
}
