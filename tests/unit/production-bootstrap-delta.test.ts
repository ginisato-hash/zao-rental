import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprintDelta,deltaMismatch} from '../../scripts/production-bootstrap';

test('fingerprintDelta uses multiset semantics and a deterministic digest',()=>{
 const d=fingerprintDelta({material:{a:['x','x','y'],b:['q']}},{material:{a:['z','x'],c:['n']}});
 assert.deepEqual(d.categories,{a:{added:['z'],removed:['x','y']},b:{added:[],removed:['q']},c:{added:['n'],removed:[]}});
 assert.equal(fingerprintDelta({material:{b:['q'],a:['y','x','x']}},{material:{c:['n'],a:['x','z']}}).sha256,d.sha256);
 assert.deepEqual(fingerprintDelta({material:{a:['r','r']}},{material:{a:['r']}}).categories.a,{added:[],removed:['r']});
});
test('an unchanged baseline cancels out, while any change on either side is reported by category',()=>{
 const base=['provider-role','provider-grant'];
 const canonical=fingerprintDelta({material:{roles:[],tables:[]}},{material:{roles:['app'],tables:['t']}});
 const provider=fingerprintDelta({material:{roles:[...base],tables:[]}},{material:{roles:[...base,'app'],tables:['t']}});
 assert.deepEqual(deltaMismatch(canonical,provider),[]);assert.equal(canonical.sha256,provider.sha256);
 const baselineChanged=fingerprintDelta({material:{roles:[...base],tables:[]}},{material:{roles:['provider-role','app'],tables:['t']}});
 assert.deepEqual(deltaMismatch(canonical,baselineChanged),['roles']);
 const extra=fingerprintDelta({material:{roles:[],tables:[]}},{material:{roles:['app','intruder'],tables:['t']}});
 assert.deepEqual(deltaMismatch(canonical,extra),['roles']);
});
import {readFileSync} from 'node:fs';
import {bootstrapRoleName,locateRoleCreationBlock,approvedEntry} from '../../scripts/production-bootstrap';

test('ephemeral bootstrap role name is deterministic, short, target- and manifest-bound',()=>{
 const m='a'.repeat(64),n=bootstrapRoleName('neondb',m);
 assert.match(n,/^zao_boot_[a-f0-9]{16}$/);assert.ok(Buffer.byteLength(n)<=63);
 assert.equal(bootstrapRoleName('neondb',m),n);assert.notEqual(bootstrapRoleName('neondb','b'.repeat(64)),n);assert.notEqual(bootstrapRoleName('zao_other_db',m),n);
 assert.throws(()=>bootstrapRoleName('zr_0123456789ab',m),/PRODUCTION_TARGET_INVALID/);assert.throws(()=>bootstrapRoleName('neondb','x'),/PRODUCTION_MANIFEST_DIGEST_INVALID/);
});
test('0015 role-creation anchor is located structurally and equals the committed pin',()=>{
 const sql=readFileSync('packages/db/migrations/0015_custody_boundary.sql','utf8');
 assert.deepEqual(locateRoleCreationBlock(sql),approvedEntry('0015').ownerCompatibility);
 // A lookalike in a comment or string, a third CREATE ROLE, or an ownership transfer before the roles is refused.
 assert.throws(()=>locateRoleCreationBlock('-- CREATE ROLE x\n'+sql),/PRODUCTION_OWNER_COMPAT_ROLE_CREATION_UNEXPECTED|NOT_DO_BLOCK/);
 assert.throws(()=>locateRoleCreationBlock(sql+"\nSELECT 'CREATE ROLE y';"),/PRODUCTION_OWNER_COMPAT_ROLE_CREATION_UNEXPECTED/);
 assert.throws(()=>locateRoleCreationBlock("ALTER TABLE t OWNER TO x;\n"+sql),/PRODUCTION_OWNER_COMPAT/);
 assert.throws(()=>locateRoleCreationBlock(sql.replace("EXECUTE format('CREATE ROLE","PERFORM ('CREATE ROLE")),/PRODUCTION_OWNER_COMPAT_ROLE_CREATION_NOT_CODE/);
});
