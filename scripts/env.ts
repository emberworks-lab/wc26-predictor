import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal .env.local loader for one-off scripts (no dotenv dependency).
 * Existing process.env values win, so CI/shell overrides work.
 */
export function loadEnvLocal(file = '.env.local'): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), file), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, key, value] = m;
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var ${key} (.env.local)`);
  return value;
}
