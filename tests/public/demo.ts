// Human-started, foreground, synthetic-only demo. Never imported by apps/web.
import {emitKeypressEvents} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {startFlowApp} from '../flow/launcher';
import {seedRecommendation} from '../recommendation/fixture';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
if(process.env.NODE_ENV==='production'||process.argv.length!==2||!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('HUMAN_FOREGROUND_SYNTHETIC_DEMO_ONLY');
async function secret(prompt:string){process.stdout.write(prompt);emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();return new Promise<string>((resolve,reject)=>{let value='';const finish=(cancel=false)=>{process.stdin.off('keypress',key);process.stdin.setRawMode(false);process.stdout.write('\n');if(cancel)reject(new Error('CANCELLED'));else resolve(value);};const key=(text:string,k:{name?:string;ctrl?:boolean})=>{if(k.ctrl&&k.name==='c')finish(true);else if(k.name==='return')finish();else if(k.name==='backspace')value=value.slice(0,-1);else if(text&&!k.ctrl&&value.length<128)value+=text;};process.stdin.on('keypress',key);});}
let app:Awaited<ReturnType<typeof startFlowApp>>|undefined;const stop=()=>void app?.stop();
try{const password=await secret('SYNTHETIC demo専用password（15–128文字・非表示）: '),again=await secret('確認: ');if(password!==again)throw new Error('PASSWORD_MISMATCH');
 app=await startFlowApp({publicP0:true});process.once('SIGINT',stop);process.once('SIGTERM',stop);await seedRecommendation(app.db.pool,true);const subject=await bootstrapDevelopmentAdmin(app.db.pool,{email:'synthetic-demo@example.invalid',displayName:'SYNTHETIC Development Demo',password});
 for(const p of ['BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','HOLD_VIEW','HOLD_EDIT','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT'])await app.db.pool.query('INSERT INTO staff_permission_overrides VALUES($1,$2,true)',[subject,p]);
 await app.db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T10:00:00+09:00'::timestamptz$$");await new QuoteService(app.roles.pricingPool,(await loadStaff(app.db.pool,subject))!).initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 console.log(`合成・実決済なし: ${app.origin}/ja/book\n利用日:2035-01-05以降 / Regular gear fixture。HOLD直前まで在庫未確保。\nスタッフ: ${app.origin}/staff/login / synthetic-demo@example.invalid / 入力したpassword\nCtrl+CでこのdemoのDB/Webだけ終了。公開URLはありません。`);process.exitCode=await app.exit;
}catch{console.error('Synthetic demo stopped; credential details withheld');process.exitCode=1;}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await app?.stop();}
