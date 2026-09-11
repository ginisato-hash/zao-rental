import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer,createConnection} from 'node:net';
import {exportController} from './export-controller';
import {runBounded} from '../tools/automation/controller/process';
import {digest} from '../tools/automation/controller/store';
import {implementationEnvironment,outerBoundaryReadiness,dispatchLive} from '../tools/automation/preparation/gates';
if(process.platform!=='darwin')throw new Error('ACTUAL_MAC_REQUIRED_NOT_A_MOCK');
const root=await realpath(await mkdtemp(resolve(tmpdir(),'zao-e02-preparation-')));
const candidate=resolve(root,'candidate'),scratch=resolve(root,'scratch'),worker=resolve(root,'probe.mjs'),socketPath=resolve(root,'control.sock'),pidFile=resolve(candidate,'detached.json');
const token=randomUUID();let detachedPid:number|undefined;let startIdentity='';const listener=createServer(socket=>socket.end());
const ps=(pid:number,field:string)=>{try{return execFileSync('/bin/ps',['-p',String(pid),'-o',field+'='],{encoding:'utf8'}).trim();}catch{return '';}};
try{
  await mkdir(candidate);await mkdir(scratch);
  const release=await exportController(process.cwd(),resolve(root,'controller'),resolve('docs/execution/policies/e02-demo-preparation.json'));
  const state=resolve(root,'controller-state.json'),secretCanary=resolve(root,'synthetic-secret');await writeFile(state,'trusted');await writeFile(secretCanary,'SYNTHETIC_ONLY');
  const code=`import {readFileSync,writeFileSync} from 'node:fs';import {createConnection} from 'node:net';import {spawn} from 'node:child_process';
const [mode,...a]=process.argv.slice(2);
if(mode==='read'){const result={};for(let i=0;i<4;i++){try{readFileSync(a[i]);result[['policyRead','controllerRead','stateRead','secretRead'][i]]='ALLOWED'}catch(e){result[['policyRead','controllerRead','stateRead','secretRead'][i]]=e.code}}
result.sharedSocket=await new Promise(done=>{const s=createConnection({path:a[4]});const end=v=>{s.destroy();done(v)};s.on('connect',()=>end('ALLOWED'));s.on('error',e=>end(e.code));s.setTimeout(1000,()=>end('TIMEOUT'));});writeFileSync(a[5],'allowed');console.log(JSON.stringify(result));}
else if(mode==='detach'){const child=spawn(process.execPath,['-e',"setTimeout(()=>process.exit(0),20000);setInterval(()=>{},1000)",a[1]],{detached:true,stdio:'ignore',env:{PATH:'/usr/bin:/bin'}});child.unref();writeFileSync(a[0],JSON.stringify({pid:child.pid,token:a[1]}));setInterval(()=>{},1000);}
else process.exit(2);`;
  await writeFile(worker,code);
  const node=await realpath(process.execPath),codex=await realpath(execFileSync('/usr/bin/which',['codex'],{encoding:'utf8'}).trim());
  const filesystem={':root':'deny',':minimal':'read','/System/Library/OpenSSL':'read',[dirname(node)]:'read',[candidate]:'write',[scratch]:'write',[release.directory]:'deny',[worker]:'read'};
  const profile=`{ filesystem = { ${Object.entries(filesystem).map(([k,v])=>`${JSON.stringify(k)} = ${JSON.stringify(v)}`).join(', ')} }, network = { enabled = false } }`;
  const plan=(args:string[])=>({executable:codex,args:['sandbox','-c',`permissions.zao_e02_prep=${profile}`,'-P','zao_e02_prep','--include-managed-config','-C',candidate,'--',node,worker,...args],cwd:candidate,env:implementationEnvironment(scratch),stdin:''});
  await new Promise<void>((ok,no)=>{listener.once('error',no);listener.listen(socketPath,ok);});
  await new Promise<void>((ok,no)=>{const s=createConnection({path:socketPath});s.once('connect',()=>{s.destroy();ok();});s.once('error',no);});
  const result=await runBounded(release,node,plan(['read',resolve(release.directory,'policy.json'),resolve(release.directory,'controller.mjs'),state,secretCanary,socketPath,resolve(candidate,'allowed')]),10_000);
  assert.equal(result.exitCode,0,result.output);const denials=JSON.parse(result.output.trim().split('\n').at(-1)!);
  for(const key of ['policyRead','controllerRead','stateRead','secretRead','sharedSocket'])assert.ok(['EPERM','EACCES'].includes(denials[key]),key+': '+denials[key]);
  assert.equal(await readFile(resolve(candidate,'allowed'),'utf8'),'allowed');
  // Deliberately tests the known gap. This fixed inert fixture has a 20-second self-expiry.
  // Its explicit cleanup is test ownership, not a claimed security boundary for arbitrary workers.
  const pending=runBounded(release,node,plan(['detach',pidFile,token]),2000);
  let child:{pid:number;token:string}|undefined;
  for(let n=0;n<100&&!child;n++){try{child=JSON.parse(await readFile(pidFile,'utf8'));}catch{await new Promise(r=>setTimeout(r,20));}}
  assert.ok(child && child.token===token);detachedPid=child.pid;startIdentity=ps(detachedPid,'lstart');assert.ok(startIdentity);assert.ok(ps(detachedPid,'command').includes(token));
  const stopped=await pending;assert.equal(stopped.reason,'TIMEOUT');assert.ok(ps(detachedPid,'stat')&&!ps(detachedPid,'stat').startsWith('Z'),'The detached fixture unexpectedly did not reproduce the known gap');
  assert.throws(()=>dispatchLive(),/LIVE_NOT_IMPLEMENTED_OR_AUTHORIZED/);
  console.log(JSON.stringify({test:'actual Mac credential-free preparation worker',profileHash:digest(profile),codexVersion:execFileSync(codex,['--version'],{encoding:'utf8'}).trim(),runtimeHashes:{codex:digest(await readFile(codex)),node:digest(await readFile(node))},denials,detachedSurvivedGroupStop:true,outerBoundary:outerBoundaryReadiness(Object.fromEntries(['docker','colima','limactl','podman','container','orb','prlctl','vmrun'].map(name=>{try{return [name,execFileSync('/usr/bin/which',[name],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()]}catch{return [name,null]}}))),modelCalls:0}));
}finally{
  if(detachedPid && ps(detachedPid,'lstart')===startIdentity && ps(detachedPid,'command').includes(token)){
    process.kill(detachedPid,'SIGKILL');for(let n=0;n<100&&ps(detachedPid,'stat')&&!ps(detachedPid,'stat').startsWith('Z');n++)await new Promise(r=>setTimeout(r,10));
    assert.ok(!ps(detachedPid,'stat')||ps(detachedPid,'stat').startsWith('Z'),'Owned detached fixture survived cleanup');console.log('PASS owned detached fixture cleaned; this is not outer containment proof.');
  }
  if(listener.listening)await new Promise<void>(done=>listener.close(()=>done()));await rm(root,{recursive:true,force:true});
}
