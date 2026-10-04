import {evaluateWorkerFreshness, parseTickLines, FRESHNESS_DEFAULTS} from '../packages/core/src/payment/worker-freshness';

/** Operator/monitor entry: `<log JSON lines> | node --import tsx scripts/production-worker-freshness.ts --expected-active`
 * (or `--intentional-stop`). Reads lines from stdin only; opens no connection and sends nothing. Exit 0 = OK or not
 * expected, 2 = ALERT. Delivering an alert needs a confirmed recipient and is held until one exists. */
export async function main(argv: string[], read: () => Promise<string>, now = Date.now()): Promise<{code: number; output: Record<string, unknown>}> {
  const active = argv.includes('--expected-active'), stop = argv.includes('--intentional-stop');
  if (active === stop || argv.some(a => !['--expected-active', '--intentional-stop'].includes(a))) throw new Error('FRESHNESS_ARGUMENTS_REJECTED');
  const text = await read();
  const records = parseTickLines(text.split('\n').filter(Boolean));
  const result = evaluateWorkerFreshness(records, {now, expectedActive: active});
  return {code: result.status === 'ALERT' ? 2 : 0, output: {...result, evaluatedAt: new Date(now).toISOString(), windows: FRESHNESS_DEFAULTS, alertDelivery: result.status === 'ALERT' ? 'HELD_NO_CONFIRMED_RECIPIENT' : 'NOT_NEEDED'}};
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const readStdin = async () => { const chunks: Buffer[] = []; for await (const c of process.stdin) chunks.push(c as Buffer); return Buffer.concat(chunks).toString('utf8'); };
  main(process.argv.slice(2), readStdin).then(({code, output}) => { console.log(JSON.stringify(output)); process.exitCode = code; })
    .catch(() => { console.error(JSON.stringify({status: 'STOP', code: 'FRESHNESS_ARGUMENTS_REJECTED'})); process.exitCode = 1; });
}
