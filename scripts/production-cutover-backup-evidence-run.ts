// READ ONLY. Confirms the independent recovery point from the scheduled production backup (GitHub Actions) against the source database's migration 0064 commit time,
// and writes the fixed-shape evidence file (never a self-declaration: prewindow-check re-verifies it online). Usage: node --import tsx scripts/production-cutover-backup-evidence-run.ts
import {assertNoTlsOverrides} from './lib/production-owner-session';
import {productionPorts,PRODUCTION_SOURCE} from './production-cutover-run';
import {collectBackupEvidence,githubBackupPort,writeBackupEvidence} from './production-cutover-backup-evidence';

if(process.argv.length!==2)throw new Error('PRODUCTION_CUTOVER_ARGUMENTS_REJECTED');
assertNoTlsOverrides();
const ports=productionPorts();ports.release();
const owner=await ports.openOwner(PRODUCTION_SOURCE);
try{
 const verdict=await collectBackupEvidence(githubBackupPort(),owner.pool,process.cwd(),new Date());
 if(verdict.ok&&verdict.evidence){
  writeBackupEvidence(process.cwd(),verdict.evidence);
  const e=verdict.evidence;
  console.log(JSON.stringify({status:'BACKUP_EVIDENCE_PRESENT',runId:e.runId,headSha:e.headSha,objectKey:e.objectKey,stepCompletedAt:e.stepCompletedAt,migrationCommittedAt:e.migrationCommittedAt,restoreTested:false,restoreEvidence:e.restoreEvidence}));
 }else{
  console.log(JSON.stringify({status:'BACKUP_EVIDENCE_ABSENT',reasons:verdict.reasons}));process.exitCode=1;
 }
}finally{await owner.close();}
