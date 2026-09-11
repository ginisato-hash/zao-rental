import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ReadOnlyGitHub,existingGhTransport,observePinnedCi,type CiPin} from '../tools/automation/preparation/github';
if(process.argv.length!==4)throw new Error('USAGE: check-github-preparation <trusted-pin.json> <NEW-evidence.json>');
const pin=JSON.parse(await readFile(process.argv[2]!,'utf8')) as CiPin;
const cwd=await mkdtemp(resolve(tmpdir(),'zao-e02-github-read-'));
try{
  const gh=execFileSync('/usr/bin/which',['gh'],{encoding:'utf8'}).trim();
  const client=new ReadOnlyGitHub(existingGhTransport(gh,cwd),process.env);
  const result={checkedAt:new Date().toISOString(),...await observePinnedCi(client,pin),auth:'Existing host gh authentication; tokens not read, printed or copied',implementationHasGithubCredentials:false,modelCalls:0};
  await writeFile(process.argv[3]!,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result));
}finally{await rm(cwd,{recursive:true,force:true});}
