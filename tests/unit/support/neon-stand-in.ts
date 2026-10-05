import {chmodSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** A stand-in for the `neon` CLI: a real executable the adapters spawn. It answers `neon api <path> [-Q k=v] [-X POST]` from fixtures keyed by path, records every invocation's argv,
 *  and exits non-zero (writing a marker to stderr) for a fixture of `{__exit: n}`; `{__raw: text}` prints text verbatim (to model an unparseable answer). A request without a fixture exits 2. */
export type StandInFixtures={get?:Record<string,unknown>;post?:Record<string,unknown>};
export function neonStandIn(dir:string,fixtures:StandInFixtures){
 const bin=join(dir,'neon'),calls=join(dir,'neon-calls.log'),fx=join(dir,'neon-fixtures.json');
 writeFileSync(fx,JSON.stringify(fixtures));
 writeFileSync(bin,`#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');
const fx=JSON.parse(fs.readFileSync(${JSON.stringify(fx)},'utf8'));const post=a.includes('-X')&&a[a.indexOf('-X')+1]==='POST';
const r=(post?fx.post:fx.get||{})&&(post?fx.post||{}:fx.get||{})[a[1]];
if(r===undefined){process.stderr.write('no fixture');process.exit(2);}
if(r&&r.__exit){process.stderr.write('STDERR-MARKER-SECRET');process.exit(r.__exit);}
if(r&&r.__raw!==undefined){process.stdout.write(String(r.__raw));process.exit(0);}
process.stdout.write(JSON.stringify(r));
`);
 chmodSync(bin,0o755);
 return {bin,calls:():string[][]=>existsSync(calls)?readFileSync(calls,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l) as string[]):[]};
}
