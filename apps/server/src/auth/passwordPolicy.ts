import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const assetPath = [
  join(moduleDirectory, '../../assets/common-passwords-10k.txt'),
  join(moduleDirectory, '../assets/common-passwords-10k.txt'),
].find(existsSync);

let commonPasswords: Set<string> | undefined;

function getCommonPasswords(): Set<string> {
  if (!assetPath) throw new Error('Common-password asset is missing');
  commonPasswords ??= new Set(
    readFileSync(assetPath, 'utf8')
      .split(/\r?\n/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  return commonPasswords;
}

export function validatePassword(password: string): 'too_short' | 'too_long' | 'common' | null {
  if (password.length < 8) return 'too_short';
  if (password.length > 128) return 'too_long';
  if (getCommonPasswords().has(password.toLowerCase())) return 'common';
  return null;
}
