import { randomInt } from 'node:crypto';

/** No 0/O or 1/I so codes are easy to read out loud. 32 symbols ^ 6 ≈ 1 billion codes. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function generateRoomCode(isTaken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!isTaken(code)) return code;
  }
  throw new Error('Could not allocate a unique room code');
}

/** Returns the canonical (upper-case) code, or null if the input cannot be a room code. */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.replace(/\s+/g, '').toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}
