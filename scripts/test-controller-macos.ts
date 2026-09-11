import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { exportController } from './export-controller';
import { digest } from '../tools/automation/controller/store';
import { sandboxPlan } from '../tools/automation/controller/boundary';
import { runBounded } from '../tools/automation/controller/process';
import { simulationFixture } from '../tools/automation/fixtures';
if (process.platform !== 'darwin') throw new Error('This is the mandatory actual-Mac boundary test, not a portable/mock test.');
const root = await realpath(await mkdtemp(resolve(tmpdir(), 'zao-e02-boundary-')));
const candidate = resolve(root, 'candidate'), scratch = resolve(root,'scratch');
const noSignal = () => {}; process.on('SIGUSR1', noSignal);
try {
  await mkdir(candidate); await mkdir(scratch); await mkdir(resolve(candidate,'.git'));
  const fixture = simulationFixture(); const policy = resolve(root,'policy.json');
  await writeFile(policy, JSON.stringify({ policy: fixture.policy, reviewPublicKey:fixture.policy.approverPublicKey }));
  const release = await exportController(process.cwd(),resolve(root,'release'),policy);
  const state = resolve(candidate,'.git','state.json'), canary = resolve(root,'synthetic-secret.txt'), writable = resolve(candidate,'allowed.txt');
  const gitConfig = resolve(candidate,'.git/config'), codexFile = resolve(candidate,'.codex/synthetic-credential.json'), claudeFile = resolve(candidate,'.claude/synthetic-credential.json'), envFile = resolve(candidate,'.env');
  await mkdir(resolve(candidate,'.codex')); await mkdir(resolve(candidate,'.claude'));
  await writeFile(gitConfig,'# synthetic fixture, no user configuration\n');
  for(const file of [codexFile,claudeFile,envFile]) await writeFile(file,'SYNTHETIC_ONLY=fixture');
  await writeFile(state,'trusted'); await writeFile(canary,'synthetic-canary-not-a-user-secret');
  const codex = await realpath(execFileSync('/bin/zsh',['-c','command -v codex'],{encoding:'utf8'}).trim());
  const node = await realpath(process.execPath);
  const binding = {codex,codexHash:digest(await readFile(codex)),node,nodeHash:digest(await readFile(node)),worktree:candidate,scratch,commonGit:resolve(candidate,'.git'),release};
  const plan = await sandboxPlan(binding,resolve(release.directory,'worker-probe.mjs'),['boundary',resolve(release.directory,'policy.json'),state,canary,writable,String(process.pid),gitConfig,codexFile,claudeFile,envFile]);
  const result = await runBounded(release,node,plan,20_000);
  assert.equal(result.exitCode,0,result.output);
  const report = JSON.parse(result.output.trim().split('\n').at(-1)!) as Record<string,unknown>;
  for(const name of ['policyWrite','policyRename','stateWrite','outsideRead','outsideSignal','symlinkWrite','gitRead','codexRead','codexWrite','claudeRead','claudeWrite','envRead','envWrite']) assert.ok(['EPERM','EACCES'].includes(String(report[name])),`${name}: ${report[name]}`);
  assert.deepEqual(report.credentialEnv,[]);
  assert.ok(!result.guardianEnvironmentKeys.includes('NODE_ENV'),'Guardian must not invent test environment');
  for(const file of [codexFile,claudeFile,envFile]) assert.equal(await readFile(file,'utf8'),'SYNTHETIC_ONLY=fixture'); assert.equal(await readFile(writable,'utf8'),'allowed'); assert.equal(await readFile(state,'utf8'),'trusted');
  console.log(JSON.stringify({test:'actual installed Codex sandbox / macOS Seatbelt',codexVersion:execFileSync(codex,['--version'],{encoding:'utf8'}).trim(),runtimeHashes:plan.runtimeHashes,profileHash:plan.profileHash,sourceSha:release.manifest.sourceSha,releaseHash:release.manifestHash,denials:report,guardianEnvironmentKeys:result.guardianEnvironmentKeys,environment:'clean PATH/LANG/TMPDIR only',modelCalls:0}));
  const pidFile = resolve(candidate,'sandbox-pids');
  const treePlan = await sandboxPlan(binding,resolve(release.directory,'worker-probe.mjs'),['tree',pidFile,'wait']);
  const treeResult = await runBounded(release,node,treePlan,2000);
  assert.equal(treeResult.reason,'TIMEOUT');
  const pids = JSON.parse(await readFile(pidFile,'utf8')) as {parent:number;child:number};
  for(const pid of [pids.parent,pids.child]) {
    let state = ''; try {state=execFileSync('/bin/ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'}).trim();} catch {}
    assert.ok(!state||state.startsWith('Z'),'Sandbox worker descendant survived timeout');
  }
  console.log('PASS actual sandbox worker and grandchild terminated on timeout; no external process scanned or killed.');
  console.log('PASS actual sandbox denies policy/state writes, git reads, codex/claude/env reads+writes, rename, symlink writes, out-of-scope reads and ancestor signals; allowed workspace write succeeds.');
} finally { process.off('SIGUSR1',noSignal); await rm(root,{recursive:true,force:true}); }
