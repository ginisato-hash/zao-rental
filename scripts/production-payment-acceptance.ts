import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,relative} from 'node:path';
import {acceptanceCommands,acceptancePlan,acceptanceRelease,runProductionPaymentAcceptance,type AcceptanceCommand} from './lib/production-payment-acceptance';

/** Explicit attended CLI only. A 0600 file outside the checkout supplies scoped credentials.
 * No .env load, automatic activation, scheduler, provider POST retry or payment-create command. */
async function main(){
 const [command,flag,path,...extra]=process.argv.slice(2);
 if(!acceptanceCommands.includes(command as AcceptanceCommand)||flag!=='--input'||!path||!isAbsolute(path)||extra.length)throw Error('M3_ARGUMENTS_REJECTED');
 const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000}).trim();
 const stat=lstatSync(path),resolved=realpathSync(path),rel=relative(git('rev-parse','--show-toplevel'),resolved);
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o600||stat.size>65536||!(rel==='..'||rel.startsWith('../'))||process.getuid&&stat.uid!==process.getuid())throw Error('M3_SECURE_INPUT_REQUIRED');
 const raw:unknown=JSON.parse(readFileSync(resolved,'utf8'));
 const {input}=acceptancePlan(raw);
 if(!/^(?:https:\/\/github\.com\/|git@github\.com:)ginisato-hash\/zao-rental(?:\.git)?$/.test(git('remote','get-url','origin')))throw Error('M3_REPOSITORY_REJECTED');
 const remote=git('ls-remote','origin','refs/heads/main').split(/\s+/);
 if(remote.length!==2||remote[1]!=='refs/heads/main')throw Error('M3_RELEASE_IDENTITY_REJECTED');
 acceptanceRelease(input,{head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),main:remote[0]!,clean:git('status','--porcelain')===''});
 const result=await runProductionPaymentAcceptance(command as AcceptanceCommand,raw,(url,init)=>globalThis.fetch(url,init));
 console.log(JSON.stringify({command,releaseId:input.releaseId,result}));
}
main().catch(error=>{
 const code=typeof error?.code==='string'?error.code:error?.message;
 const safe=typeof code==='string'&&/^(?:M3_[A-Z_]+|PRODUCTION_(?:IDENTITY|RECONCILIATION|PROJECTION)_[A-Z_]+|PROJECTION_[A-Z_]+|STALE_PROJECTION_REVISION)$/.test(code)?code:'M3_OPERATION_FAILED';
 console.error(JSON.stringify({status:'STOP',code:safe}));process.exitCode=1;
});
