import {spawnSync} from 'node:child_process';
// Fixed foreground commands only. Reuse the existing real-PG state-machine regression.
// No shell text, provider credentials, external requests or persistent process.
for (const path of ['tests/readiness/square-activation.ts','tests/flow/payment.ts']) {
 const result=spawnSync(process.execPath,['--import','tsx',path],{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status??1);
}
console.log('Square activation harness complete: transport fixtures + real PostgreSQL payment regression. Real Sandbox remains NOT_RUN.');
