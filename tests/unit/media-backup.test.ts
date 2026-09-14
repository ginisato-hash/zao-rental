import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rehearseMediaBackup,type MediaBackupPlan,type MediaBackupPort} from '../../packages/core/src/content/media-backup';
import {mediaObjectKey} from '../../packages/core/src/content/provider-media';
test('P5 media backup requires exact private encrypted off-host manifest and actual restore acknowledgement',async()=>{
 const plan:MediaBackupPlan={id:randomUUID(),revision:'synthetic-r1',rightsRevision:'synthetic-rights1',objects:[{kind:'ORIGINAL',sha256:'a'.repeat(64),bytes:100,mime:'image/png'},{kind:'DERIVATIVE',sha256:'b'.repeat(64),bytes:50,mime:'image/webp'}],retentionUntil:'2035-02-01T00:00:00Z'};let corrupt=false,privateOnly=true,restored=true;
 const port:MediaBackupPort={id:'SYNTHETIC_MEMORY',async capture(p,planSha256){return {planSha256,manifestSha256:'c'.repeat(64),encrypted:true,offHost:true,private:privateOnly,verifiedObjects:p.objects.map(o=>({key:mediaObjectKey(o),sha256:corrupt?'d'.repeat(64):o.sha256,bytes:o.bytes}))};},async restoreCheck(manifestSha256){return {manifestSha256,integrityPassed:restored};}};
 const now=new Date('2035-01-01');assert.equal((await rehearseMediaBackup(plan,port,now)).productionAcceptance,false);corrupt=true;await assert.rejects(rehearseMediaBackup(plan,port,now),{code:'MEDIA_BACKUP_UNCONFIRMED'});corrupt=false;privateOnly=false;await assert.rejects(rehearseMediaBackup(plan,port,now),{code:'MEDIA_BACKUP_UNCONFIRMED'});privateOnly=true;restored=false;await assert.rejects(rehearseMediaBackup(plan,port,now),{code:'MEDIA_RESTORE_UNCONFIRMED'});
});
