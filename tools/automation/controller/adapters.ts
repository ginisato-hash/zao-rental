import { resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import type { Operation, Adapter } from './engine';
import { Stop } from './engine';
import type { ProcessPlan } from './process';
export type Toolchain = { git: string; gh: string; codex: string; claude: string; npm: string };
export type LaunchContext = { root: string; branch: string; base: string; head: string; taskSchema: string; report: string; prompt: string; cleanEnv: Record<string, string> };
export async function restrictedCommand(kind: Operation['kind'], tools: Toolchain, c: LaunchContext): Promise<ProcessPlan> {
  const cwd = await realpath(c.root);
  if (cwd !== c.root || !/^codex\/e[0-9]{2}$/.test(c.branch) || !/^[a-f0-9]{40}$/.test(c.base) || !/^[a-f0-9]{40}$/.test(c.head)) throw new Stop('INVALID_COMMAND_CONTEXT');
  for (const path of Object.values(tools)) if (!path.startsWith('/') || path.includes('\0')) throw new Stop('EXECUTABLE_MUST_BE_ABSOLUTE');
  // No inherited credentials, shell startup, NODE_OPTIONS, GIT_CONFIG_*, LD_*, provider URLs or tokens.
  if (Object.keys(c.cleanEnv).some(k => !['PATH', 'LANG', 'TMPDIR'].includes(k))) throw new Stop('UNAPPROVED_CHILD_ENVIRONMENT');
  const commands: Record<Operation['kind'], [string, string[]]> = {
    branch: [tools.git, ['-c','core.hooksPath=/dev/null','switch','-c',c.branch,c.base]],
    push: [tools.git, ['push','origin',`${c.head}:refs/heads/${c.branch}`]],
    implement: [tools.codex, ['exec','--ignore-user-config','--sandbox','workspace-write','--ephemeral','--json','--output-schema',c.taskSchema,'--cd',cwd,'-']],
    verify: [tools.npm, ['run','verify']],
    draft: [tools.gh, ['pr','create','--repo','ginisato-hash/zao-rental','--draft','--head',c.branch,'--base','main','--body-file',c.report]],
    observe: [tools.git, ['--no-optional-locks','rev-parse','HEAD']],
    ci: [tools.gh, ['run','list','--repo','ginisato-hash/zao-rental','--commit',c.head,'--json','databaseId,headSha,status,conclusion']],
    review: [tools.claude, ['--safe-mode','-p','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--disable-slash-commands','--no-session-persistence','--no-chrome','--permission-mode','dontAsk','--output-format','json','--max-turns','3']],
  };
  const command = commands[kind]; if (!command) throw new Stop('UNAPPROVED_OPERATION');
  // Credentialed publication/review use a distinct empty cwd after separate live provisioning.
  return { executable: command[0], args: command[1], cwd, env: c.cleanEnv, stdin: ['implement','review'].includes(kind) ? c.prompt : '' };
}
export class DisabledLiveAdapter implements Adapter {
  readonly mode = 'LIVE' as const;
  async invoke(): Promise<never> { throw new Stop('LIVE_DISABLED_SEPARATE_AUTHORIZATION_REQUIRED'); }
  async reconcile(): Promise<never> { throw new Stop('LIVE_DISABLED_SEPARATE_AUTHORIZATION_REQUIRED'); }
}
// Kept separate so no caller can send an unchecked shell string to the process supervisor.
export function requireControllerFile(release: string, file: string) {
  if (file !== resolve(release, 'task-result.schema.json') && file !== resolve(release, 'report.md')) throw new Stop('UNTRUSTED_CONTROLLER_INPUT_PATH');
}
