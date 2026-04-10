import crypto from 'node:crypto';

function md5(data: string): string {
  return crypto.createHash('md5').update(data).digest('hex');
}

function parseDigestChallenge(header: string): Record<string, string> {
  const value = header.replace(/^Digest\s+/i, '');
  const pairs = value.match(/(\w+)=("[^"]+"|[^,]+)/g) ?? [];
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim().replace(/^"|"$/g, '');
    out[k] = v;
  }
  return out;
}

export function buildDigestHeader(params: { wwwAuthenticate: string; method: string; uri: string; username: string; password: string; }): string {
  const challenge = parseDigestChallenge(params.wwwAuthenticate);
  const realm = challenge.realm;
  const nonce = challenge.nonce;
  const qop = challenge.qop?.includes('auth') ? 'auth' : undefined;
  if (!realm || !nonce) throw new Error('Invalid digest challenge');

  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const ha1 = md5(`${params.username}:${realm}:${params.password}`);
  const ha2 = md5(`${params.method}:${params.uri}`);
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);

  const segments = [
    `username="${params.username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${params.uri}"`,
    qop ? `qop=${qop}` : undefined,
    qop ? `nc=${nc}` : undefined,
    qop ? `cnonce="${cnonce}"` : undefined,
    `response="${response}"`,
    challenge.opaque ? `opaque="${challenge.opaque}"` : undefined
  ].filter(Boolean);

  return `Digest ${segments.join(', ')}`;
}
