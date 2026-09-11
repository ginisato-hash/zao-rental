import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verify } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import receiptSchema from '../../../docs/execution/schemas/review-receipt.schema.json';
import taskSchema from '../../../docs/execution/schemas/task-result.schema.json';
import { classifyFailure, checkChangedFiles, evaluate, validateApproval, type SignedApproval, type Policy, type Evidence } from '../runner';
import { Journal, digest } from './store';
import { verifyRelease, type Release } from './release';
const ajv = new Ajv2020({ strict: true });
const validReceipt = ajv.compile(receiptSchema); const validTask = ajv.compile(taskSchema);
export type Receipt = { payload: { taskId: string; runId: string; baseSha: string; headSha: string; specHash: string; snapshotHash: string; reviewHash: string }; signature: string };
export type ReviewEnvelope = { review: unknown; receipt: Receipt; snapshotHash: string };
export type Operation = { kind: 'branch' | 'push' | 'implement' | 'verify' | 'draft' | 'ci' | 'review' | 'observe'; key: string; input: Record<string, unknown> };
export interface Adapter {
  readonly mode: 'FAKE' | 'LIVE';
  invoke(operation: Operation): Promise<unknown>;
  reconcile(operation: Operation): Promise<{ found: true; result: unknown } | { found: false }>;
}
export class Stop extends Error { constructor(readonly reason: string) { super(reason); } }
export async function once(journal: Journal, adapter: Adapter, operation: Operation) {
  const hash = digest(JSON.stringify(operation)); const old = journal.data.operations[operation.key];
  if (old) {
    if (old.inputHash !== hash) throw new Stop('OPERATION_INPUT_CHANGED');
    if (old.state === 'DONE') return old.result;
    // Reconciliation is read-only. UNKNOWN never becomes permission to repeat an effect.
    const observed = await adapter.reconcile(operation);
    if (!observed.found) throw new Stop('UNKNOWN_EFFECT_HUMAN_RECONCILIATION_REQUIRED');
    old.state = 'DONE'; old.result = observed.result; await journal.save(); return old.result;
  }
  if (operation.kind === 'implement' && ++journal.data.modelAttempts > 3) throw new Stop('MODEL_CALL_LIMIT');
  if (operation.kind === 'review' && ++journal.data.reviewAttempts > 3) throw new Stop('REVIEW_CALL_LIMIT');
  journal.data.operations[operation.key] = { kind: operation.kind, inputHash: hash, state: 'INTENT' };
  await journal.save();
  const result = await adapter.invoke(operation);
  journal.data.operations[operation.key] = { kind: operation.kind, inputHash: hash, state: 'DONE', result };
  await journal.save(); return result;
}
export function validateReviewReceipt(envelope: ReviewEnvelope, key: string, expected: Receipt['payload']) {
  if (!validReceipt(envelope.receipt)) throw new Stop('INVALID_REVIEW_RECEIPT');
  if (!verify(null, Buffer.from(JSON.stringify(envelope.receipt.payload)), key, Buffer.from(envelope.receipt.signature, 'base64'))) throw new Stop('UNTRUSTED_REVIEW');
  for (const field of Object.keys(expected) as (keyof Receipt['payload'])[]) if (envelope.receipt.payload[field] !== expected[field]) throw new Stop('STALE_REVIEW_RECEIPT');
  if (digest(JSON.stringify(envelope.review)) !== expected.reviewHash || envelope.snapshotHash !== expected.snapshotHash) throw new Stop('REVIEW_CONTENT_CHANGED');
}
export async function runPreflight(args: { journal: Journal; adapter: Adapter; release: Release; signed: SignedApproval; worktree: string; specHash: string }) {
  const { journal, adapter, release } = args;
  await verifyRelease(release.directory, release.manifestHash, args.worktree);
  const config = JSON.parse(await readFile(resolve(release.directory, 'policy.json'), 'utf8')) as { policy: Policy; reviewPublicKey: string };
  const { policy, reviewPublicKey } = config;
  // Deliberate executable gate, not a candidate-controlled environment flag.
  if (adapter.mode !== 'FAKE') throw new Stop('LIVE_DISABLED_SEPARATE_AUTHORIZATION_REQUIRED');
  const approval = validateApproval(args.signed, policy, args.specHash);
  if (journal.data.bindingHash !== digest(JSON.stringify(args.signed)) || journal.data.taskId !== approval.taskId || journal.data.releaseHash !== release.manifestHash) throw new Stop('JOURNAL_APPROVAL_MISMATCH');
  const started = journal.data.startedAt;
  if (!Number.isSafeInteger(started) || started > Date.now()) throw new Stop('INVALID_RUN_CLOCK');
  const step = async (kind: Operation['kind'], key: string, input: Record<string, unknown>) => {
    await journal.lease.assertOwned(); await verifyRelease(release.directory, release.manifestHash, args.worktree);
    validateApproval(args.signed, policy, args.specHash); // expiry also checked between operations
    if (Date.now() - started >= policy.maxMinutes * 60_000) throw new Stop('WALL_CLOCK_LIMIT');
    if (kind === 'observe' || kind === 'ci') return adapter.invoke({kind,key,input});
    return once(journal, adapter, { kind, key, input });
  };
  try {
    await step('branch', 'branch', { branch: journal.data.branch, base: approval.baseSha });
    for (let round = journal.data.fixRound; round <= 2; round++) {
      const implementation = await step('implement', `implement-${round}`, { round, branch: journal.data.branch, base: approval.baseSha, specHash: args.specHash });
      if (!validTask(implementation)) throw new Stop('INVALID_TASK_RESULT');
      const task = implementation as { task_id: string; status: string; head_sha: string; base_sha: string; spec_hash: string; changed_files: string[]; commands: { exit_code: number }[]; known_gaps: string[] };
      if (task.task_id !== approval.taskId || task.base_sha !== approval.baseSha || task.spec_hash !== args.specHash || task.status !== 'READY_FOR_REVIEW' || task.known_gaps.length) throw new Stop('TASK_IDENTITY_OR_STATUS');
      // The adapter's independent verify result supplies observed git/path/command evidence.
      const observed = await step('verify', `verify-${round}`, { head: task.head_sha, base: approval.baseSha }) as { head: string; changed: string[]; exitCodes: number[]; snapshotHash: string };
      if (!/^[a-f0-9]{64}$/.test(observed.snapshotHash) || observed.head !== task.head_sha || JSON.stringify(observed.changed) !== JSON.stringify(task.changed_files)) throw new Stop('OBSERVED_HEAD_OR_DIFF_MISMATCH');
      const scopeError = checkChangedFiles(approval, policy, observed.changed);
      if (scopeError || !observed.exitCodes.length || observed.exitCodes.some(x=>x!==0)) throw new Stop(scopeError ?? 'VERIFICATION_FAILED');
      const current = await step('observe', `observe-${round}`, {head:observed.head,base:approval.baseSha}) as {head:string;base:string;changed:string[]};
      if (current.head !== observed.head || current.base !== approval.baseSha || JSON.stringify(current.changed) !== JSON.stringify(observed.changed)) throw new Stop('CURRENT_HEAD_BASE_OR_DIFF_CHANGED');
      const pushed = await step('push', `push-${round}`, {branch:journal.data.branch,head:observed.head}) as {head:string;branch:string};
      if(pushed.head!==observed.head||pushed.branch!==journal.data.branch) throw new Stop('PUSH_IDENTITY_MISMATCH');
      const draft = await step('draft', 'draft', { branch: journal.data.branch, base:approval.baseSha, draft: true }) as {number:number;draft:boolean;head:string;base:string;branch:string};
      if (!Number.isSafeInteger(draft.number) || draft.number<1 || draft.draft!==true || draft.base!==approval.baseSha || draft.branch!==journal.data.branch) throw new Stop('DRAFT_IDENTITY_MISMATCH');
      const ci = await step('ci', `ci-${round}`, { head: observed.head, base: approval.baseSha }) as Evidence['ci'];
      let review: unknown = undefined;
      const evidence: Evidence = { taskId: approval.taskId, baseSha: approval.baseSha, specHash: args.specHash, headSha: observed.head, changedFiles: observed.changed, commandExitCodes: observed.exitCodes, draft: true, ci, review };
      // Failed CI may request a bounded repair; missing/pending/stale CI never calls a model.
      let decision = evaluate(approval, policy, evidence, round, (Date.now() - started) / 60_000);
      if (decision.reason === 'INVALID_OR_MISSING_REVIEW') {
        const envelope = await step('review', `review-${round}`, { head: observed.head, base: approval.baseSha, runId: journal.data.runId }) as ReviewEnvelope;
        validateReviewReceipt(envelope, reviewPublicKey, { taskId: approval.taskId, runId: journal.data.runId, baseSha: approval.baseSha, headSha: observed.head, specHash: args.specHash, snapshotHash: observed.snapshotHash, reviewHash: digest(JSON.stringify(envelope.review)) });
        review = envelope.review; evidence.review = review;
        decision = evaluate(approval, policy, evidence, round, (Date.now() - started) / 60_000);
      }
      const finalState = await step('observe', `final-observe-${round}`, {head:observed.head,base:approval.baseSha}) as {head:string;base:string;changed:string[];pr:{number:number;draft:boolean;head:string;base:string;branch:string}};
      if (!finalState.pr || finalState.pr.number!==draft.number || !finalState.pr.draft || finalState.pr.head!==observed.head || finalState.pr.base!==approval.baseSha || finalState.pr.branch!==journal.data.branch) throw new Stop('CURRENT_PR_CHANGED');
      if (finalState.head !== observed.head || finalState.base !== approval.baseSha || JSON.stringify(finalState.changed) !== JSON.stringify(observed.changed)) throw new Stop('CURRENT_HEAD_BASE_OR_DIFF_CHANGED');
      journal.data.status = decision.status; await journal.save();
      if (decision.status !== 'FIX_REQUIRED') return decision;
      journal.data.fixRound = decision.fixRound; await journal.save();
    }
    throw new Stop('FIX_ROUND_LIMIT');
  } catch (error) {
    journal.data.status = 'BLOCKED'; await journal.save();
    return { status: 'BLOCKED' as const, reason: error instanceof Stop ? error.reason : classifyFailure(1, error instanceof Error ? error.message : ''), fixRound: journal.data.fixRound };
  }
}
