import { randomInt } from 'node:crypto';

/**
 * Public reference codes: exactly 6 uppercase letters/digits (e.g.
 * "A4X8Q2"). 36^6 ≈ 2.2 billion combinations, so random collisions are
 * rare — the caller still retries on the unique-index violation to be
 * collision-safe under any load.
 */
const REFERENCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const REFERENCE_CODE_LENGTH = 6;

export function generateReferenceCode(): string {
  let code = '';
  for (let i = 0; i < REFERENCE_CODE_LENGTH; i += 1) {
    code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return code;
}
