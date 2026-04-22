declare module 'ws' {
  export type RawData = string | Buffer | ArrayBuffer | Buffer[];

  export interface ClientOptions {
    headers?: Record<string, string>;
  }

  export default class WebSocket {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;

    readonly readyState: number;

    constructor(address: string | URL, options?: ClientOptions);

    on(event: 'open', listener: () => void): this;
    on(event: 'message', listener: (data: RawData) => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;

    close(): void;
    removeAllListeners(): this;
  }
}
