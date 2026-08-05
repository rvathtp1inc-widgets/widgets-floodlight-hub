import {
  MAX_VIRTUAL_SECURITY_ZONE,
  MIN_VIRTUAL_SECURITY_ZONE,
  VirtualSecurityDesiredState
} from './types.js';

export function buildElkZoneChangeFrame(
  zoneNumber: number,
  state: VirtualSecurityDesiredState
): Buffer {
  if (
    !Number.isInteger(zoneNumber) ||
    zoneNumber < MIN_VIRTUAL_SECURITY_ZONE ||
    zoneNumber > MAX_VIRTUAL_SECURITY_ZONE
  ) {
    throw new Error(`zoneNumber must be an integer from ${MIN_VIRTUAL_SECURITY_ZONE} through ${MAX_VIRTUAL_SECURITY_ZONE}.`);
  }
  if (state !== 'Normal' && state !== 'Violated') {
    throw new Error('state must be Normal or Violated.');
  }

  const body = `0AZC${String(zoneNumber).padStart(3, '0')}${state === 'Normal' ? '1' : '9'}00`;
  const sum = Buffer.from(body, 'ascii').reduce((total, byte) => total + byte, 0);
  const checksum = ((-sum) & 0xff).toString(16).toUpperCase().padStart(2, '0');
  return Buffer.from(`${body}${checksum}\r\n`, 'ascii');
}
