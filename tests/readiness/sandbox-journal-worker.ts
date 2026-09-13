// Test-only child. Synthetic restricted DB credentials arrive through IPC, never argv/log/files.
import {Pool} from 'pg';
import {SandboxActivationJournal} from '../../packages/core/src/payment/sandbox-activation';
import type {Connection} from '../../packages/auth/src/config';
import type {PaymentRequest} from '../../packages/contracts/src/rental-flow';
process.once('message',async(message:{db:Connection;request:PaymentRequest;paymentId:string})=>{
 let pool:Pool|undefined;
 try{
  if(message.db.host!=='127.0.0.1'||!/^zr_[a-f0-9]{12}$/.test(message.db.database)||message.db.user!==message.db.database+'_flow')throw new Error('FIXTURE_DATABASE_REQUIRED');
  pool=new Pool({...message.db,max:1,connectionTimeoutMillis:2000});const journal=new SandboxActivationJournal(pool),codes:string[]=[];
  for(const operation of [()=>journal.reserve(message.request),()=>journal.reserveRefund(message.request.idempotencyKey,message.paymentId,100,message.request.merchantId)]){try{await operation();codes.push('UNEXPECTED_SUCCESS');}catch(e){codes.push(String((e as {code?:string}).code??'UNCLASSIFIED'));}}
  const rows=(await pool.query("SELECT operation,count(*)::int n FROM sandbox_activation_calls GROUP BY operation ORDER BY operation")).rows;
  await pool.end();pool=undefined;process.send?.({codes,counts:rows},undefined,undefined,()=>process.disconnect());
 }catch{await pool?.end();process.exitCode=1;process.send?.({error:'FIXTURE_JOURNAL_WORKER_FAILED'},undefined,undefined,()=>process.disconnect());}
});
