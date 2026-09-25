import { createHash, randomBytes, randomInt } from 'node:crypto';

const OTP_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generateAdminPassword(length = 20): string {
  return Array.from({ length }, () => OTP_ALPHABET[randomInt(OTP_ALPHABET.length)]).join('');
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
