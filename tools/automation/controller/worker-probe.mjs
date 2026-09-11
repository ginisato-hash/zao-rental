// Inert process/filesystem probes. No model, GitHub, production data or user secrets are read.
import { writeFileSync, readFileSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
const [mode, ...args] = process.argv.slice(2);
if (mode === 'boundary') {
  const [policy, state, canary, writable, targetPid, gitConfig, codexFile, claudeFile, envFile] = args; const results = {};
  for (const [label, action] of Object.entries({ policyWrite: () => writeFileSync(policy, 'modified'), policyRename: () => renameSync(policy, policy + '.moved'), stateWrite: () => writeFileSync(state, 'forged'), gitRead: () => readFileSync(gitConfig), codexRead: () => readFileSync(codexFile), codexWrite: () => writeFileSync(codexFile, 'modified'), claudeRead: () => readFileSync(claudeFile), claudeWrite: () => writeFileSync(claudeFile, 'modified'), envRead: () => readFileSync(envFile), envWrite: () => writeFileSync(envFile, 'modified'), outsideRead: () => readFileSync(canary), outsideSignal: () => process.kill(Number(targetPid), 'SIGUSR1') })) {
    try { action(); results[label] = 'ALLOWED'; } catch (e) { results[label] = e.code; }
  }
  writeFileSync(writable, 'allowed');
  const link = writable + '.link'; symlinkSync(policy, link);
  try { writeFileSync(link, 'modified'); results.symlinkWrite = 'ALLOWED'; } catch (e) { results.symlinkWrite = e.code; } finally { unlinkSync(link); }
  results.credentialEnv = Object.keys(process.env).filter(k => /TOKEN|SECRET|API_KEY|NODE_OPTIONS|GIT_CONFIG/.test(k));
  console.log(JSON.stringify(results));
} else if (mode === 'tree') {
  const [pidFile, exitMode] = args;
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'inherit', env: { PATH: '/usr/bin:/bin' } });
  writeFileSync(pidFile, JSON.stringify({ parent: process.pid, child: child.pid }));
  process.on('SIGTERM', () => {});
  if (exitMode === 'crash') setTimeout(() => process.exit(7), 80);
  else setInterval(() => {}, 1000);
} else { console.error('UNKNOWN_PROBE'); process.exit(2); }
