/**
 * Polite typed client for football-data.org v4.
 *
 * Runtime-agnostic (Node seed script + Deno Edge Function): global fetch only.
 * Politeness: spaces consecutive calls (free tier = 10 req/min), retries with
 * backoff on 429 (honouring Retry-After) and on 5xx.
 */

import type {
  ApiMatchesResponse,
  ApiScorersResponse,
  ApiStandingsResponse,
} from './types';

const BASE_URL = 'https://api.football-data.org/v4';
const COMPETITION = 'WC';

export interface FootballApiClientOptions {
  apiKey: string;
  /** Minimum gap between consecutive requests. Default 6.5s (≈9/min). */
  minIntervalMs?: number;
  /** Max attempts per request (1 initial + retries). Default 4. */
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
}

export class FootballApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = 'FootballApiError';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class FootballApiClient {
  private readonly apiKey: string;
  private readonly minIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;
  private lastRequestAt = 0;
  /** API calls actually sent (incl. retries) — reported to sync_log. */
  callsMade = 0;

  constructor(opts: FootballApiClientOptions) {
    this.apiKey = opts.apiKey;
    this.minIntervalMs = opts.minIntervalMs ?? 6_500;
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(path: string): Promise<T> {
    let attempt = 0;
    for (;;) {
      attempt += 1;

      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
      this.callsMade += 1;

      const res = await this.fetchImpl(`${BASE_URL}${path}`, {
        headers: { 'X-Auth-Token': this.apiKey },
      });

      if (res.ok) return (await res.json()) as T;

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.maxAttempts) {
        throw new FootballApiError(
          `football-data.org ${res.status} on ${path}`,
          res.status,
          path,
        );
      }

      const retryAfter = Number(res.headers.get('Retry-After'));
      const backoff =
        res.status === 429
          ? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60) * 1_000
          : 1_000 * 2 ** (attempt - 1);
      await sleep(backoff);
    }
  }

  getMatches(): Promise<ApiMatchesResponse> {
    return this.request(`/competitions/${COMPETITION}/matches`);
  }

  getStandings(): Promise<ApiStandingsResponse> {
    return this.request(`/competitions/${COMPETITION}/standings`);
  }

  getScorers(limit = 100): Promise<ApiScorersResponse> {
    return this.request(`/competitions/${COMPETITION}/scorers?limit=${limit}`);
  }
}
