import { createHash, randomUUID, verify } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import reviewSchema from '../../docs/execution/schemas/review-result.schema.json';

export type Policy = {
  enabled: false; autoMerge: false; production: false; paidApi: false;
  maxFixRounds: 2; maxMinutes: number; approverPublicKey: string;
  protectedPaths: string[]; requiredChecks: string[];
};
export type Approval = {
  taskId: string; status: 'READY'; baseSha: string; specHash: string;
  allowedPaths: string[]; dependenciesMerged: boolean; expiresAt: string;
};
export type SignedApproval = { payload: Approval; signature: string };
export type Evidence = {
  taskId: string; baseSha: string; specHash: string; headSha: string;
  changedFiles: string[]; commandExitCodes: number[];
  draft: boolean; ci: { headSha: string; checks: Record<string, 'success' | 'failure' | 'pending'>; runId: string };
  review: unknown;
};
export type Result = { status: 'AWAITING_APPROVAL' | 'FIX_REQUIRED' | 'BLOCKED'; reason: string; fixRound: number; headSha: string };
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const validateReview = new Ajv2020({ allErrors: true, strict: true }).compile(reviewSchema);
export function approvalBytes(payload: Approval) { return Buffer.from(JSON.stringify(payload)); }
function checkPath(path: string) {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some(segment => segment === '..' || segment === '.' || segment === '.git') || /[\x00-\x1f]/.test(path)) throw new Error('INVALID_PATH');
}
function inScope(path: string, pattern: string) { return pattern.endsWith('/') ? path.startsWith(pattern) : path === pattern; }
export function validateApproval(signed: SignedApproval, policy: Policy, expectedSpecHash: string, now = Date.now()): Approval {
  if (policy.enabled !== false || policy.autoMerge !== false || policy.production !== false || policy.paidApi !== false || policy.maxFixRounds !== 2 || !Number.isFinite(policy.maxMinutes) || policy.maxMinutes <= 0 || policy.maxMinutes > 60 || !policy.requiredChecks.length || !policy.protectedPaths.length) throw new Error('UNSAFE_POLICY');
  if (!verify(null, approvalBytes(signed.payload), policy.approverPublicKey, Buffer.from(signed.signature, 'base64'))) throw new Error('UNTRUSTED_APPROVAL');
  const a = signed.payload;
  if (!/^E[0-9]{2}$/.test(a.taskId) || a.status !== 'READY' || !sha.test(a.baseSha) || !hash.test(a.specHash) || a.specHash !== expectedSpecHash || !a.dependenciesMerged || !Number.isFinite(Date.parse(a.expiresAt)) || Date.parse(a.expiresAt) <= now || !a.allowedPaths.length) throw new Error('INVALID_APPROVAL');
  a.allowedPaths.forEach(checkPath); policy.protectedPaths.forEach(checkPath);
  return a;
}
// Hash must come from the trusted controller, not from the candidate PR or a label.
// Same-UID path/mode checks alone cannot protect policy. Live mode remains absent.
export async function loadProtectedPolicy(path: string, pinnedHash: string, worktree: string): Promise<Policy> {
  if (!hash.test(pinnedHash)) throw new Error('MISSING_TRUST_ANCHOR');
  const [source, root] = await Promise.all([realpath(path), realpath(worktree)]);
  const rel = relative(root, source);
  if (!rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) throw new Error('POLICY_INSIDE_WORKTREE');
  const raw = await readFile(source);
  if (createHash('sha256').update(raw).digest('hex') !== pinnedHash) throw new Error('POLICY_HASH_MISMATCH');
  return JSON.parse(raw.toString()) as Policy;
}
export async function claimTask(stateDirectory: string, approval: Approval, now = Date.now()) {
  if (!/^E[0-9]{2}$/.test(approval.taskId)) throw new Error('INVALID_TASK_ID');
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const lock = resolve(stateDirectory, `${approval.taskId}.lock`);
  try { await mkdir(lock, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('TASK_ALREADY_CLAIMED_RECONCILIATION_REQUIRED');
    throw error;
  }
  const claim = { token: randomUUID(), pid: process.pid, taskId: approval.taskId, baseSha: approval.baseSha, specHash: approval.specHash, worktree: process.cwd(), claimedAt: now, leaseUntil: now + 60 * 60 * 1000 };
  await writeFile(`${lock}/claim.json`, JSON.stringify(claim), { flag: 'wx', mode: 0o600 });
  return { claim, async release() {
    const saved = JSON.parse(await readFile(`${lock}/claim.json`, 'utf8')) as typeof claim;
    if (saved.token !== claim.token) throw new Error('CLAIM_OWNERSHIP_CHANGED');
    await rm(lock, { recursive: true });
  } };
}
export function commandPlan(approval: Approval, worktree: string, repo: string) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('INVALID_REPOSITORY');
  const branch = `codex/${approval.taskId.toLowerCase()}`;
  return [
    { stage: 'worktree', argv: ['git', 'worktree', 'add', '-b', branch, worktree, approval.baseSha] },
    { stage: 'implement', argv: ['codex', 'exec', '--ignore-user-config', '--sandbox', 'workspace-write', '--json', '--output-schema', '<protected-task-result.schema.json>', '--cd', worktree, '-'], stdin: '<controller-approved prompt, never an untrusted PR instruction>' },
    { stage: 'verify', argv: ['npm', 'run', 'verify'], credentialBoundary: 'separate process without agent/provider/GitHub credentials' },
    { stage: 'push', argv: ['git', 'push', 'origin', `HEAD:refs/heads/${branch}`], credentialBoundary: 'controller only after SHA/path/approval check' },
    { stage: 'draft', argv: ['gh', 'pr', 'create', '--repo', repo, '--draft', '--head', branch, '--base', 'main', '--body-file', '<controller-generated-report.md>'] },
    { stage: 'ci', argv: ['gh', 'run', 'list', '--repo', repo, '--commit', '<verified-head-sha>', '--json', 'databaseId,headSha,conclusion,status'], note: 'require all policy check names; an empty response is BLOCKED' },
    { stage: 'claude', argv: ['claude', '-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence', '--max-turns', '1'], stdin: '<trusted review contract + inert sanitized snapshot and evidence>', credentialBoundary: 'separate empty working directory; no candidate hooks/settings or code execution' },
    { stage: 'fix', maxRounds: 2, note: 'new SHA invalidates CI and review; re-enter verify → draft update → CI → review' },
    { stage: 'stop', status: 'AWAITING_APPROVAL', note: 'no merge, production or next dependent task' },
  ];
}
export function evaluate(approval: Approval, policy: Policy, evidence: Evidence, fixRound: number, elapsedMinutes: number): Result {
  const blocked = (reason: string): Result => ({ status: 'BLOCKED', reason, fixRound, headSha: evidence.headSha });
  if (!Number.isInteger(fixRound) || fixRound < 0 || fixRound > policy.maxFixRounds || !Number.isFinite(elapsedMinutes) || elapsedMinutes < 0 || elapsedMinutes >= policy.maxMinutes) return blocked('TIME_OR_ROUND_LIMIT');
  if (evidence.taskId !== approval.taskId || evidence.baseSha !== approval.baseSha || evidence.specHash !== approval.specHash || !sha.test(evidence.headSha)) return blocked('EVIDENCE_IDENTITY_MISMATCH');
  if (!evidence.draft || !evidence.commandExitCodes.length || evidence.commandExitCodes.some(code => code !== 0)) return blocked('IMPLEMENTATION_OR_DRAFT_MISSING');
  for (const file of evidence.changedFiles) {
    try { checkPath(file); } catch { return blocked('INVALID_PATH'); }
    if (policy.protectedPaths.some(pattern => inScope(file, pattern))) return blocked('PROTECTED_FILE_CHANGE');
    if (!approval.allowedPaths.some(pattern => inScope(file, pattern))) return blocked('OUT_OF_SCOPE_CHANGE');
  }
  if (evidence.ci.headSha !== evidence.headSha || !evidence.ci.runId || policy.requiredChecks.some(check => !['success', 'failure'].includes(evidence.ci.checks[check] ?? ''))) return blocked('CI_MISSING_PENDING_OR_STALE');
  if (policy.requiredChecks.some(check => evidence.ci.checks[check] === 'failure')) return fixRound >= policy.maxFixRounds ? blocked('FIX_ROUND_LIMIT') : { status: 'FIX_REQUIRED', reason: 'CI_FAILED', fixRound: fixRound + 1, headSha: evidence.headSha };
  if (!validateReview(evidence.review)) return blocked('INVALID_OR_MISSING_REVIEW');
  const review = evidence.review as { task_id: string; base_sha: string; head_sha: string; spec_hash: string; verdict: string; unverified: string[]; findings: { severity: string }[] };
  if (review.task_id !== approval.taskId || review.base_sha !== approval.baseSha || review.head_sha !== evidence.headSha || review.spec_hash !== approval.specHash) return blocked('STALE_REVIEW');
  if (review.verdict === 'BLOCKED' || review.unverified.length) return blocked('REVIEW_UNVERIFIED');
  // The schema already rejects unknown labels. Keep this final gate independently explicit:
  // a future schema enum extension must never silently become permission to advance.
  if (review.verdict === 'PASS' && review.findings.every(f => ['MEDIUM', 'LOW'].includes(f.severity))) {
    return { status: 'AWAITING_APPROVAL', reason: 'EXACT_SHA_EVIDENCE_READY_NO_MERGE', fixRound, headSha: evidence.headSha };
  }
  if (review.verdict === 'CHANGES_REQUIRED' || review.findings.some(f => ['BLOCKER', 'HIGH'].includes(f.severity))) {
    return fixRound >= policy.maxFixRounds ? blocked('FIX_ROUND_LIMIT') : { status: 'FIX_REQUIRED', reason: 'REVIEW_FINDINGS', fixRound: fixRound + 1, headSha: evidence.headSha };
  }
  return blocked('REVIEW_NOT_EXPLICITLY_ACCEPTABLE');
}
export function classifyFailure(exitCode: number, output: string): string {
  if (/429|quota|rate.?limit|usage.?limit|credit|insufficient.*balance/i.test(output)) return 'QUOTA_BLOCKED_NO_API_FALLBACK';
  if (/401|403|unauthori[sz]ed|authentication|login|permission denied/i.test(output)) return 'AUTH_BLOCKED_NO_API_FALLBACK';
  if (/timeout|timed out|network|ECONN/i.test(output)) return 'TRANSPORT_BLOCKED_RECONCILE_BEFORE_RETRY';
  return exitCode !== 0 ? 'COMMAND_FAILED' : 'MISSING_OR_INVALID_OUTPUT';
}
