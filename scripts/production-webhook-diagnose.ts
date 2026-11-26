// Read-only Production diagnostic for the Square webhook/payment reconciliation (Issue #47 P0-A). One READ ONLY transaction through the pinned owner session
// (same admission as the coupon-admin `verify`: accepted main, no TLS override, verify-full). Output is counts, states, fixed enums and dates only: no ids,
// amounts, names, hashes or connection details. It writes nothing and calls no provider.
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {neonCliPort} from './production-backup-credential';
import {assertAcceptedMainRelease,assertNoTlsOverrides,openOwnerSession} from './lib/production-owner-session';
const NEON_BIN=join(homedir(),'.npm/_npx/978debf9b3a75271/node_modules/.bin/neon');
type Q={name:string;sql:string};
export const QUERIES:Q[]=[
 {name:'inbox_by_env_state',sql:"SELECT environment,state,coalesce(last_error,'-') AS last_error,count(*)::int AS n,min(received_at)::date AS first_day,max(received_at)::date AS last_day FROM square_webhook.inbox GROUP BY 1,2,3 ORDER BY 1,2,3"},
 {name:'inbox_by_day_since_oct',sql:"SELECT received_at::date AS day,environment,count(*)::int AS n FROM square_webhook.inbox WHERE received_at>='2026-10-25' GROUP BY 1,2 ORDER BY 1,2"},
 {name:'payment_attempts_by_state',sql:"SELECT state,count(*)::int AS n,min(created_at)::date AS first_day,max(created_at)::date AS last_day FROM rental_payment_attempts GROUP BY 1 ORDER BY 1"},
 {name:'payment_attempts_since_nov',sql:"SELECT created_at::date AS day,state,count(*)::int AS n FROM rental_payment_attempts WHERE created_at>='2026-11-01' GROUP BY 1,2 ORDER BY 1,2"},
 {name:'completed_without_provider_event',sql:"SELECT count(*)::int AS n FROM rental_payment_attempts a WHERE a.state='COMPLETED' AND NOT EXISTS(SELECT 1 FROM rental_provider_events e WHERE e.attempt_id=a.id)"},
 {name:'provider_events_by_outcome',sql:"SELECT outcome,count(*)::int AS n,min(received_at)::date AS first_day,max(received_at)::date AS last_day FROM rental_provider_events GROUP BY 1 ORDER BY 1"},
 {name:'refund_requests_by_state',sql:"SELECT state,count(*)::int AS n,min(created_at)::date AS first_day,max(created_at)::date AS last_day FROM ops_refund_requests GROUP BY 1 ORDER BY 1"},
 {name:'receiver_role',sql:"SELECT r.rolname,r.rolcanlogin,has_function_privilege(r.oid,'square_webhook.receive(text,text,text,text,text,text)','EXECUTE') AS can_receive FROM pg_roles r WHERE r.rolname LIKE '%pay_receipt%'"},
];
export async function main(){
 assertNoTlsOverrides();const head=assertAcceptedMainRelease();
 if(!existsSync(NEON_BIN))throw new Error('PRODUCTION_INSTALL_NEON_CLI_MISSING');
 const session=await openOwnerSession(neonCliPort(NEON_BIN));
 try{
  await session.client.query('BEGIN READ ONLY');const out:Record<string,unknown>={};
  for(const q of QUERIES){try{out[q.name]=(await session.client.query(q.sql)).rows;}catch(e){out[q.name]={error:String((e as {code?:string}).code??'ERR')};}}
  await session.client.query('ROLLBACK');
  console.log(JSON.stringify({sourceSha:head,diagnostic:'WEBHOOK_PAYMENT_READ_ONLY',...out}));
 }finally{await session.close();}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){main().catch(e=>{const m=String((e as Error)?.message??'');console.error(JSON.stringify({status:'STOP',code:/^PRODUCTION_INSTALL_[A-Z0-9_]{1,60}$/.test(m)?m:'PRODUCTION_WEBHOOK_DIAGNOSE_FAILED'}));process.exitCode=1;});}
