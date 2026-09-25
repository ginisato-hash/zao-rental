import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMERCIAL_DB_SERVICES} from '../../packages/core/src/guest/production-commercial-composition';
import {
 COMMERCIAL_CREDENTIAL_PROBES,COMMERCIAL_CREDENTIAL_SERVICES,PRODUCTION_CREDENTIAL_ACTIVATION_VERSION,
 assertScramSha256Verifier,buildScramSha256Verifier,commercialCredentialRoleNames,
 productionCredentialActivationPlan,productionCredentialActivationSql,productionCredentialPasswordFromEntropy,
 productionCredentialRollbackSql,
} from '../../scripts/production-credential-activation';

test('credential tranche is exactly the ten commercial DB services and excludes avatar/payment/backup',()=>{
 assert.deepEqual([...COMMERCIAL_CREDENTIAL_SERVICES],[...COMMERCIAL_DB_SERVICES]);
 assert.deepEqual([...COMMERCIAL_CREDENTIAL_SERVICES],['auth','ledger','hold','transfer','pricing','recommendation','operations','guest','content_read','booking_access']);
 const roles=commercialCredentialRoleNames('neondb');
 assert.deepEqual(Object.values(roles),[
  'neondb_auth','neondb_ledger','neondb_hold','neondb_transfer','neondb_pricing',
  'neondb_recommendation','neondb_operations','neondb_guest','neondb_content_read','neondb_booking_access',
 ]);
 for(const forbidden of ['neondb_avatar_read','neondb_pay_receipt','neondb_pay_dispatch','neondb_pay_truth','neondb_pay_projection','neondb_pay_diagnostic','neondb_backup'])
  assert.ok(!Object.values(roles).includes(forbidden as never));
});

test('password encoding requires exactly 256 bits and is URL-safe ASCII',()=>{
 const p=productionCredentialPasswordFromEntropy(Buffer.alloc(32,0xab));
 assert.equal(p.length,43);
 assert.match(p,/^[A-Za-z0-9_-]{43}$/);
 assert.throws(()=>productionCredentialPasswordFromEntropy(Buffer.alloc(31)),/ENTROPY_INVALID/);
});

test('SCRAM-SHA-256 verifier matches an independently pinned vector and validates strictly',()=>{
 const password=productionCredentialPasswordFromEntropy(Buffer.from('95f46bc9d50a9c8f7b0ed8e93cf0f6ad65a13f8fa20d0b77f39801910cb7ff01','hex'));
 const verifier=buildScramSha256Verifier(password,4096,Buffer.from('0123456789abcdef','ascii'));
 assert.equal(verifier,'SCRAM-SHA-256$4096:MDEyMzQ1Njc4OWFiY2RlZg==$gnnUST8HMiWyihGRGRhGuueVBkH4eCRtGptGAFf9Nvc=:ouPOKTsXIBFuoNVvhSrY60kL+c0LEd99tACJshsP17A=');
 assert.doesNotThrow(()=>assertScramSha256Verifier(verifier));
 assert.throws(()=>assertScramSha256Verifier(verifier.replace('4096','1')),/VERIFIER_INVALID/);
 assert.throws(()=>buildScramSha256Verifier('short',4096,Buffer.alloc(16)),/PASSWORD_INVALID/);
 assert.throws(()=>buildScramSha256Verifier(password,4095,Buffer.alloc(16)),/ITERATIONS_INVALID/);
 assert.throws(()=>buildScramSha256Verifier(password,4096,Buffer.alloc(15)),/SALT_INVALID/);
});

test('activation and rollback SQL use only the manager path; activation contains verifier, never plaintext password',()=>{
 const password=productionCredentialPasswordFromEntropy(Buffer.alloc(32,7));
 const verifier=buildScramSha256Verifier(password,4096,Buffer.alloc(16,9));
 const activate=productionCredentialActivationSql('neondb','content_read',verifier);
 assert.deepEqual(activate,['SET LOCAL ROLE "neondb_role_admin"','ALTER ROLE "neondb_content_read" LOGIN PASSWORD \''+verifier+'\'']);
 assert.ok(!activate.join('\n').includes(password));
 assert.doesNotThrow(()=>assertScramSha256Verifier(verifier));
 const rollback=productionCredentialRollbackSql('neondb','content_read');
 assert.deepEqual(rollback,['SET LOCAL ROLE "neondb_role_admin"','ALTER ROLE "neondb_content_read" NOLOGIN PASSWORD NULL']);
 assert.throws(()=>productionCredentialActivationSql('neondb','content_read','not-a-verifier'),/VERIFIER_INVALID/);
});

test('all ten services have one read-only positive and one 42501 negative probe',()=>{
 assert.deepEqual(Object.keys(COMMERCIAL_CREDENTIAL_PROBES),[...COMMERCIAL_CREDENTIAL_SERVICES]);
 for(const service of COMMERCIAL_CREDENTIAL_SERVICES){
  const p=COMMERCIAL_CREDENTIAL_PROBES[service];
  assert.ok(p.positive.startsWith('SELECT '),service);
  assert.ok(p.negative.startsWith('SELECT '),service);
  assert.equal(p.negativeSqlState,'42501');
  assert.doesNotMatch(p.positive,/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(p.negative,/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
 }
});

test('secret-free activation plan is deterministic and binds canary/probes/proof contract',()=>{
 const p=productionCredentialActivationPlan('neondb');
 assert.equal(p.version,PRODUCTION_CREDENTIAL_ACTIVATION_VERSION);
 assert.equal(p.version,'production-credential-activation/1');
 assert.equal(p.managerRole,'neondb_role_admin');
 assert.equal(p.canary,'content_read');
 assert.equal(p.services.length,10);
 assert.equal(p.remainingOperationalRolesStayNoLogin,true);
 assert.match(p.planSha256,/^[a-f0-9]{64}$/);
 assert.equal(productionCredentialActivationPlan('neondb').planSha256,p.planSha256);
 assert.notEqual(productionCredentialActivationPlan('zao_rental_other').planSha256,p.planSha256);
 const encoded=JSON.stringify(p);
 assert.doesNotMatch(encoded,/PASSWORD '|SCRAM-SHA-256\$/);
});
