import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function randomToken(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

export function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}

function sessionSecret(key: string): Buffer {
  return createHash('sha256').update(key).digest();
}

export function seal(payload: object, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sessionSecret(key), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function open<T>(token: string, key: string): T | null {
  try {
    const buf = Buffer.from(token, 'base64url');
    if (buf.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', sessionSecret(key), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const json = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function hashKey(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

export function hashEquals(hexHash: string, token: string, pepper: string): boolean {
  const expected = Buffer.from(hexHash, 'hex');
  const actual = Buffer.from(hashKey(token, pepper), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
