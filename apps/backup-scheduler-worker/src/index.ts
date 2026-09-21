// Future Cloudflare Worker Cron scheduler for the Production backup workflow.
// R2B ships this source and its wrangler.toml only; no Cron Trigger is activated,
// no Worker secret is created, and `wrangler deploy` is never run in this phase.

/** Fixed dispatch target. No request/event input can ever change these. */
export const TARGET_REPO = 'ginisato-hash/zao-rental';
export const TARGET_WORKFLOW = 'production-backup.yml';
export const TARGET_REF = 'main';
/** Documented future cron; not registered as a Trigger until a separate R4 activation deploy. */
export const TARGET_CRON = '17 * * * *';

export interface WorkerEnv {
  /** Fine-grained token: this exact repo only, Actions:write, no Contents/Administration/Secrets. Not created in R2B. */
  GITHUB_ACTIONS_DISPATCH_TOKEN: string;
}

/** Minimal local shapes — avoids adding @cloudflare/workers-types for two structural fields. */
export interface ScheduledController { cron: string; scheduledTime: number }
export interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }

export interface DispatchResult { ok: boolean; status: number }

/**
 * POST GitHub's workflow_dispatch endpoint for the one fixed backup workflow.
 * Takes only `env` (the token) and `scheduledAtIso` — there is no parameter through
 * which a caller could redirect the target repo, workflow file, or ref.
 *
 * `scheduledAtIso` becomes the `scheduled_at` workflow_dispatch input, so the backup
 * script's object keys and daily-promotion classification are derived from Cloudflare's
 * own scheduled-occurrence time, not the runtime clock of whichever GitHub Actions
 * runner happens to pick up the job. A retry of the same scheduled occurrence carries
 * the same `scheduledAtIso` and therefore resolves to the same deterministic object key.
 */
export async function dispatchProductionBackup(env: WorkerEnv, scheduledAtIso: string, fetchImpl: typeof fetch = fetch): Promise<DispatchResult> {
  const url = `https://api.github.com/repos/${TARGET_REPO}/actions/workflows/${TARGET_WORKFLOW}/dispatches`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_ACTIONS_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'zao-rental-production-backup-scheduler',
    },
    body: JSON.stringify({ref: TARGET_REF, inputs: {scheduled_at: scheduledAtIso}}),
  });
  if (response.status >= 200 && response.status < 300) return {ok: true, status: response.status};
  // Non-2xx GitHub response: structured, non-secret failure only. Never log headers/token.
  return {ok: false, status: response.status};
}

const worker = {
  async scheduled(controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    const scheduledAtIso = new Date(controller.scheduledTime).toISOString();
    ctx.waitUntil((async () => {
      const result = await dispatchProductionBackup(env, scheduledAtIso);
      if (!result.ok) console.error('PRODUCTION_BACKUP_DISPATCH_FAILED status=' + result.status);
    })());
  },
  // Deliberately no `fetch()` handler: this Worker exposes no public HTTP endpoint.
};

export default worker;
