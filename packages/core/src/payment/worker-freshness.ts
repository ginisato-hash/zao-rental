/** Independent freshness check for the scheduled worker. It reads the tick log lines (the app's own JSON lines, or Vercel
 * runtime-log JSON whose `message` carries them) and decides from the outside, so detection never depends on the worker
 * running again. Only a COMPLETED tick counts as success: a dormant (NOT_ACTIVATED) answer, a skipped overlap, a provider
 * stop and a failure never do. */
export const FRESHNESS_DEFAULTS = Object.freeze({maxSuccessAgeSeconds: 300, maxBacklogAgeSeconds: 900, consecutiveFailureLimit: 3});

export interface TickRecord { time: number; event: 'normal_worker_tick' | 'normal_worker_tick_dormant'; state?: string; code?: string; pendingPayments?: number; oldestPendingAgeSeconds?: number }
export interface FreshnessOptions { now: number; expectedActive: boolean; maxSuccessAgeSeconds?: number; maxBacklogAgeSeconds?: number; consecutiveFailureLimit?: number }
export interface FreshnessResult {
  status: 'OK' | 'ALERT' | 'NOT_EXPECTED'; reasons: string[];
  lastSuccessAgeSeconds: number | null; lastTickState: string | null; pendingPayments: number | null; oldestPendingAgeSeconds: number | null; dormantTicks: number; failedTicks: number;
}

const isTickEvent = (v: unknown): v is TickRecord['event'] => v === 'normal_worker_tick' || v === 'normal_worker_tick_dormant';

/** Accepts either the raw app line or a log object with `message` (string JSON) and a millisecond/ISO timestamp. Anything else is ignored. */
export function parseTickLines(lines: readonly string[], fallbackTime?: number): TickRecord[] {
  const out: TickRecord[] = [];
  for (const line of lines) {
    let value: unknown; try { value = JSON.parse(line); } catch { continue; }
    let carrier = value as Record<string, unknown>;
    const time: unknown = carrier?.['timestamp'] ?? carrier?.['time'];
    if (typeof carrier?.['message'] === 'string') { try { carrier = JSON.parse(carrier['message'] as string) as Record<string, unknown>; } catch { continue; } }
    if (!carrier || !isTickEvent(carrier['event'])) continue;
    // A tick record without a state cannot be judged either way, so it is not evidence.
    if (carrier['event'] === 'normal_worker_tick' && typeof carrier['state'] !== 'string') continue;
    const at = typeof time === 'number' ? time : typeof time === 'string' ? Date.parse(time) : fallbackTime;
    if (at === undefined || !Number.isFinite(at)) continue;
    const record: TickRecord = {time: at, event: carrier['event']};
    if (typeof carrier['state'] === 'string') record.state = carrier['state'];
    if (typeof carrier['code'] === 'string') record.code = carrier['code'];
    if (typeof carrier['pendingPayments'] === 'number') record.pendingPayments = carrier['pendingPayments'];
    if (typeof carrier['oldestPendingAgeSeconds'] === 'number') record.oldestPendingAgeSeconds = carrier['oldestPendingAgeSeconds'];
    out.push(record);
  }
  return out.sort((a, b) => a.time - b.time);
}

export function evaluateWorkerFreshness(records: readonly TickRecord[], options: FreshnessOptions): FreshnessResult {
  const maxSuccess = options.maxSuccessAgeSeconds ?? FRESHNESS_DEFAULTS.maxSuccessAgeSeconds, maxBacklog = options.maxBacklogAgeSeconds ?? FRESHNESS_DEFAULTS.maxBacklogAgeSeconds;
  const failureLimit = options.consecutiveFailureLimit ?? FRESHNESS_DEFAULTS.consecutiveFailureLimit;
  const past = records.filter(r => r.time <= options.now);
  const ran = past.filter(r => r.event === 'normal_worker_tick'), dormant = past.filter(r => r.event === 'normal_worker_tick_dormant');
  const successes = ran.filter(r => r.state === 'COMPLETED'), lastSuccess = successes.at(-1), latest = past.at(-1);
  const failed = ran.filter(r => r.state !== 'COMPLETED');
  const result: FreshnessResult = {
    status: 'OK', reasons: [], lastSuccessAgeSeconds: lastSuccess ? Math.max(0, Math.round((options.now - lastSuccess.time) / 1000)) : null,
    lastTickState: ran.at(-1)?.state ?? null, pendingPayments: lastSuccess?.pendingPayments ?? null, oldestPendingAgeSeconds: lastSuccess?.oldestPendingAgeSeconds ?? null,
    dormantTicks: dormant.length, failedTicks: failed.length,
  };
  // An intentional stop (or a deployment that is meant to be dormant) is reported but never alerts and never counts as success.
  if (!options.expectedActive) return {...result, status: 'NOT_EXPECTED'};
  if (!lastSuccess || options.now - lastSuccess.time > maxSuccess * 1000) result.reasons.push('NO_SUCCESSFUL_TICK_WITHIN_WINDOW');
  if (latest?.event === 'normal_worker_tick_dormant') result.reasons.push('DORMANT_WHILE_EXPECTED_ACTIVE');
  if (ran.length >= failureLimit && ran.slice(-failureLimit).every(r => r.state !== 'COMPLETED')) result.reasons.push('CONSECUTIVE_TICK_FAILURES');
  if (lastSuccess && (lastSuccess.oldestPendingAgeSeconds ?? 0) > maxBacklog) result.reasons.push('BACKLOG_AGING');
  return {...result, status: result.reasons.length ? 'ALERT' : 'OK'};
}
