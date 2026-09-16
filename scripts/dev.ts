import {createInterface} from 'node:readline/promises';
import {emitKeypressEvents} from 'node:readline';
import {startDevelopmentApp} from './development-app';
import {bootstrapDevelopmentAdmin} from './bootstrap-staff';
const args=process.argv.slice(2);if(args.some(a=>a!=='--bootstrap-admin'))throw new Error('Supported option: --bootstrap-admin');
if(args.includes('--bootstrap-admin')&&(!process.stdin.isTTY||!process.stdout.isTTY))throw new Error('Bootstrap requires a human-operated terminal; do not pass secrets as arguments or files');
const app=await startDevelopmentApp({operations:true});
const stop=()=>void app.stop();process.once('SIGINT',stop);process.once('SIGTERM',stop);
async function secret(prompt:string){process.stdout.write(prompt);emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise<string>((resolve,reject)=>{let value='';const finish=(cancel=false)=>{process.stdin.off('keypress',key);process.stdin.setRawMode(false);process.stdout.write('\n');if(cancel)reject(new Error('BOOTSTRAP_CANCELLED'));else resolve(value);};const key=(text:string,k:{name?:string;ctrl?:boolean})=>{if(k.ctrl&&k.name==='c')finish(true);else if(k.name==='return')finish();else if(k.name==='backspace')value=value.slice(0,-1);else if(text&&!k.ctrl&&value.length<128)value+=text;};process.stdin.on('keypress',key);});
}
try{
 if(args.includes('--bootstrap-admin')){const reader=createInterface({input:process.stdin,output:process.stdout});const email=await reader.question('開発用ADMINのemail: ');const displayName=await reader.question('表示名: ');reader.close();const password=await secret('パスワード（15〜128文字・非表示）: ');const again=await secret('もう一度入力（非表示）: ');if(password!==again)throw new Error('PASSWORD_CONFIRMATION_MISMATCH');await bootstrapDevelopmentAdmin(app.db.pool,{email,displayName,password});console.log('開発用ADMINを登録しました。パスワードの表示・保存ログはありません。');}
 console.log(`ZAO Rental development: ${app.origin}/staff/login; owned fresh PostgreSQL; stop with Ctrl+C. Data survives logout, not this disposable cluster's restart.`);
 if(!args.length)console.log('アカウント未登録。初期ADMINは npm run dev -- --bootstrap-admin を人間のターミナルで使用します。');
 process.exitCode=await app.exit;
}catch{console.error('Development operation stopped; account and credential details withheld');process.exitCode=1;}
finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await app.stop();}
