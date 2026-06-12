/**
 * Bundles the sync Edge Function for deployment.
 *
 * Why: the function imports the pure engine modules from src/, which use
 * extensionless TypeScript imports that Deno cannot resolve natively. esbuild
 * resolves and inlines them; `npm:`/`jsr:`/`node:` specifiers are left for the
 * Deno edge runtime.
 *
 *   node scripts/bundle-sync.mjs        → .build/sync/index.ts
 *
 * Deploy the bundle as function `sync` (verify_jwt OFF — the function does its
 * own x-sync-secret auth), e.g. via the Supabase MCP deploy_edge_function or:
 *   supabase functions deploy sync --project-ref ejiuelstlbncfaljthfr --no-verify-jwt
 * after pointing the CLI at the bundled output.
 */

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('.build/sync', { recursive: true });

await build({
  entryPoints: ['supabase/functions/sync/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'esnext',
  outfile: '.build/sync/index.ts',
  alias: { '@': './src' },
  external: ['npm:*', 'jsr:*', 'node:*', 'https:*'],
  logLevel: 'info',
});
