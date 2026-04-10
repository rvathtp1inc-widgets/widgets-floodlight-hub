import { buildDigestHeader } from './digestAuth.js';
import { config } from '../../config.js';

type RpcResult = Record<string, unknown>;

async function rpc(host: string, port: number, path: string, password?: string): Promise<RpcResult> {
  const url = `http://${host}:${port}${path}`;
  const first = await fetch(url, { signal: AbortSignal.timeout(config.requestTimeoutMs) });

  if (first.status === 401 && password) {
    const challenge = first.headers.get('www-authenticate');
    if (!challenge) throw new Error('Shelly auth challenge missing');
    const digest = buildDigestHeader({
      wwwAuthenticate: challenge,
      method: 'GET',
      uri: path,
      username: 'admin',
      password
    });
    const retry = await fetch(url, {
      headers: { Authorization: digest },
      signal: AbortSignal.timeout(config.requestTimeoutMs)
    });
    if (!retry.ok) throw new Error(`Shelly RPC error ${retry.status}`);
    return (await retry.json()) as RpcResult;
  }

  if (!first.ok) throw new Error(`Shelly RPC error ${first.status}`);
  return (await first.json()) as RpcResult;
}

export const shellyService = {
  async getStatus(host: string, port = 80, relayId = 0, password?: string) {
    return rpc(host, port, `/rpc/Switch.GetStatus?id=${relayId}`, password);
  },

  async getConfig(host: string, port = 80, relayId = 0, password?: string) {
    return rpc(host, port, `/rpc/Switch.GetConfig?id=${relayId}`, password);
  },

  async setOutput(host: string, port = 80, relayId = 0, on: boolean, password?: string) {
    return rpc(host, port, `/rpc/Switch.Set?id=${relayId}&on=${on}`, password);
  },

  async standardizeConfig(host: string, port = 80, relayId = 0, password?: string) {
    await rpc(host, port, `/rpc/Switch.SetConfig?id=${relayId}&config=${encodeURIComponent(JSON.stringify({ auto_off: false, auto_on: false }))}`, password);
    return this.getConfig(host, port, relayId, password);
  },

  async healthCheck(host: string, port = 80, relayId = 0, password?: string) {
    try {
      await this.getStatus(host, port, relayId, password);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
};
