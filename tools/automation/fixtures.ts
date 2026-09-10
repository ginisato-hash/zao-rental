import { generateKeyPairSync, sign } from 'node:crypto';
import { approvalBytes, type Approval, type Policy, type Evidence } from './runner';
export function simulationFixture() {
  // Ephemeral signer is only test data; it can never authorize a live process.
  const keys = generateKeyPairSync('ed25519');
  const approval: Approval = { taskId: 'E01', status: 'READY', baseSha: 'a'.repeat(40), specHash: 'b'.repeat(64), allowedPaths: ['apps/web/', 'packages/'], dependenciesMerged: true, expiresAt: new Date(Date.now() + 60000).toISOString() };
  const policy: Policy = { enabled: false, autoMerge: false, production: false, paidApi: false, maxFixRounds: 2, maxMinutes: 60, approverPublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), protectedPaths: ['.github/', 'tools/automation/', 'AGENTS.md', 'CLAUDE.md', 'package-lock.json', 'docs/execution/', 'packages/db/migrations/'], requiredChecks: ['foundation'] };
  const evidence: Evidence = { taskId: approval.taskId, baseSha: approval.baseSha, specHash: approval.specHash, headSha: 'c'.repeat(40), changedFiles: ['apps/web/src/app/page.tsx'], commandExitCodes: [0], draft: true, ci: { headSha: 'c'.repeat(40), checks: { foundation: 'success' }, runId: 'SIMULATED-ONLY' }, review: { task_id: approval.taskId, base_sha: approval.baseSha, head_sha: 'c'.repeat(40), spec_hash: approval.specHash, verdict: 'PASS', findings: [], checks_read: ['SIMULATED-ONLY'], unverified: [] } };
  return { approval, policy, evidence, signed: { payload: approval, signature: sign(null, approvalBytes(approval), keys.privateKey).toString('base64') } };
}
