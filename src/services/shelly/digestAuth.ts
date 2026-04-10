import crypto from 'node:crypto';

type DigestAlgorithm = 'MD5' | 'MD5-SESS' | 'SHA-256' | 'SHA-256-SESS' | 'SHA-512-256' | 'SHA-512-256-SESS';

function digest(data: string, algorithm: DigestAlgorithm): string {
  const normalized = algorithm.toUpperCase() as DigestAlgorithm;
  const hashAlgo =
    normalized === 'MD5' || normalized === 'MD5-SESS'
      ? 'md5'
      : normalized === 'SHA-256' || normalized === 'SHA-256-SESS'
        ? 'sha256'
        : 'sha512-256';
  return crypto.createHash(hashAlgo).update(data).digest('hex');
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
  const algorithm = (challenge.algorithm?.toUpperCase() as DigestAlgorithm | undefined) ?? 'MD5';
  const qop = challenge.qop?.includes('auth') ? 'auth' : undefined;
  if (!realm || !nonce) throw new Error('Invalid digest challenge');

  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const baseHa1 = digest(`${params.username}:${realm}:${params.password}`, algorithm);
  const ha1 = algorithm.endsWith('-SESS') ? digest(`${baseHa1}:${nonce}:${cnonce}`, algorithm) : baseHa1;
  const ha2 = digest(`${params.method}:${params.uri}`, algorithm);
  const response = qop
    ? digest(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`, algorithm)
    : digest(`${ha1}:${nonce}:${ha2}`, algorithm);

  const segments = [
    `username="${params.username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${params.uri}"`,
    challenge.algorithm ? `algorithm=${challenge.algorithm}` : undefined,
    qop ? `qop=${qop}` : undefined,
    qop ? `nc=${nc}` : undefined,
    qop ? `cnonce="${cnonce}"` : undefined,
    `response="${response}"`,
    challenge.opaque ? `opaque="${challenge.opaque}"` : undefined
  ].filter(Boolean);

  return `Digest ${segments.join(', ')}`;
}
