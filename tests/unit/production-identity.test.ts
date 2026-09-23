// V4 (TD correction): production-identity.ts's exact-identity gate has no test-only issuer and no
// override parameter anywhere — issueExactProductionIdentity(c) always enforces the real pinned
// Production identity. This file proves that boundary two ways, neither needing the real Neon
// hostname (never committed to this public repository):
//
// 1. Layer A/B pure functions (productionHostFingerprint/productionVercelProjectFingerprint/
//    assertProductionIdentityFacts) operate only on synthetic hostnames or already-computed SHA-256
//    digests — the accept path is proven by passing the pinned (already-public) fingerprint
//    constants directly as facts, never a real hostname plaintext.
// 2. issueExactProductionIdentity itself is exercised for its reject paths using the real,
//    already-public Vercel project ID (`prj_ehUMOzM77em9DVnHJBJffncD5hg7`, already committed and
//    reviewed in packages/core/src/payment/r15-projection-authority.ts) and the real, already-public
//    database name (`neondb`, EXPECTED_PRODUCTION_DATABASE_NAME) alongside a synthetic (wrong) host
//    — proving the function correctly isolates and reports exactly which field is wrong, without
//    ever needing the one value this repo deliberately never commits: the real hostname.
//
// The full accept path of issueExactProductionIdentity — a config whose real host also matches —
// is provable only in the real Production environment. Disclosed, not hidden: see RESULT.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as readiness from '../../packages/db/src/production-db-readiness';
import {migrationPlan} from '../../packages/db/src/index';
import {
  productionHostFingerprint,
  productionVercelProjectFingerprint,
  assertProductionIdentityFacts,
  issueExactProductionIdentity,
  exactProductionIdentityConfiguration,
  EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,
  EXPECTED_PRODUCTION_DATABASE_NAME,
  EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256,
  type ProductionIdentityFacts,
} from '../../packages/auth/src/production-identity';
import {productionConfiguration, productionServices, type ProductionConfiguration} from '../../packages/auth/src/production-config';
import {productionGuestConfiguration, guestConfigurationHash} from '../../packages/contracts/src/production-guest';

// Already public and already committed/reviewed elsewhere in this repo — not a new disclosure.
const REAL_VERCEL_PROJECT_ID = 'prj_ehUMOzM77em9DVnHJBJffncD5hg7';

// ---- Layer A: pure fingerprint computation (any synthetic input) ----

test('productionHostFingerprint normalizes case and surrounding whitespace before hashing', () => {
  const a = productionHostFingerprint('Ep-Example.Neon.Tech');
  const b = productionHostFingerprint('  ep-example.neon.tech  ');
  assert.equal(a, b);
  assert.equal(a, createHash('sha256').update('ep-example.neon.tech').digest('hex'));
});
test('productionHostFingerprint is deterministic and distinguishes different hosts', () => {
  assert.equal(productionHostFingerprint('a.neon.tech'), productionHostFingerprint('a.neon.tech'));
  assert.notEqual(productionHostFingerprint('a.neon.tech'), productionHostFingerprint('b.neon.tech'));
});
test('productionVercelProjectFingerprint is a plain deterministic SHA-256, no normalization (IDs are already case-sensitive exact)', () => {
  assert.equal(productionVercelProjectFingerprint(REAL_VERCEL_PROJECT_ID), createHash('sha256').update(REAL_VERCEL_PROJECT_ID).digest('hex'));
  assert.equal(productionVercelProjectFingerprint(REAL_VERCEL_PROJECT_ID), EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256);
});

// ---- Layer B: pure fingerprint comparison — accept path proven with pinned public constants ----

function realFacts(overrides: Partial<ProductionIdentityFacts> = {}): ProductionIdentityFacts {
  return {
    hostFingerprintSha256: EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,
    databaseName: EXPECTED_PRODUCTION_DATABASE_NAME,
    vercelProjectFingerprintSha256: EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256,
    ...overrides,
  };
}
test('assertProductionIdentityFacts accepts the exact pinned fingerprint facts — no real hostname plaintext needed for this proof', () => {
  assert.doesNotThrow(() => assertProductionIdentityFacts(realFacts()));
});
test('assertProductionIdentityFacts rejects a wrong host fingerprint specifically', () => {
  assert.throws(() => assertProductionIdentityFacts(realFacts({hostFingerprintSha256: productionHostFingerprint('some-other-host.neon.tech')})), {message: 'PRODUCTION_IDENTITY_WRONG_HOST'});
});
test('assertProductionIdentityFacts rejects a wrong database name specifically', () => {
  assert.throws(() => assertProductionIdentityFacts(realFacts({databaseName: 'some_other_database'})), {message: 'PRODUCTION_IDENTITY_WRONG_DATABASE_NAME'});
});
test('assertProductionIdentityFacts rejects a wrong Vercel project fingerprint specifically', () => {
  assert.throws(() => assertProductionIdentityFacts(realFacts({vercelProjectFingerprintSha256: productionVercelProjectFingerprint('a-different-project-id')})), {message: 'PRODUCTION_IDENTITY_WRONG_VERCEL_PROJECT'});
});
test('assertProductionIdentityFacts checks Vercel project before host before database name (field priority)', () => {
  const allWrong = {
    hostFingerprintSha256: productionHostFingerprint('wrong.neon.tech'),
    databaseName: 'wrong_db',
    vercelProjectFingerprintSha256: productionVercelProjectFingerprint('wrong-project'),
  };
  assert.throws(() => assertProductionIdentityFacts(allWrong), {message: 'PRODUCTION_IDENTITY_WRONG_VERCEL_PROJECT'});
});

// ---- issueExactProductionIdentity: reject paths on the real product function ----

const guestPolicy = productionGuestConfiguration({schemaVersion: 1, revision: 'V4-FIXTURE', ingressAdapterId: 'v4-fixture-dispatcher', policy: {version: 'V4-FIXTURE', contextSeconds: 3600, absoluteSeconds: 7200, recoverySeconds: 3600, replaySeconds: 30, retentionSeconds: 60, windowSeconds: 10, peerRequests: 1000, globalRequests: 2000}});
function configWith(overrides: Partial<{database: Partial<ProductionConfiguration['database']>; deployment: Partial<ProductionConfiguration['deployment']>}> = {}): ProductionConfiguration {
  return productionConfiguration({
    schemaVersion: 1, capability: 'ZAO_PRODUCTION_RUNTIME_V1',
    deployment: {provider: 'VERCEL', environment: 'production', projectId: REAL_VERCEL_PROJECT_ID, releaseId: 'v4-release', origin: 'https://v4-fixture.invalid', ...overrides.deployment},
    database: {provider: 'NEON', environment: 'production', name: EXPECTED_PRODUCTION_DATABASE_NAME, host: 'ep-v4-fixture.neon.tech', roles: Object.fromEntries(productionServices.map((s) => [s, 'v4_' + s + '_role'])), ...overrides.database},
    flags: {booking: false, guestRecovery: false, payment: false, media: false, avatar: false, staffOperations: false},
    guest: guestPolicy, approvedGuestSha256: guestConfigurationHash(guestPolicy),
    payment: null, media: null,
  });
}
test('issueExactProductionIdentity: real Vercel project + real database name + synthetic (wrong) host is rejected as WRONG_HOST specifically', () => {
  // Proves the real function correctly isolates the host as the failing field, using only
  // already-public values (the project ID and "neondb") — the real hostname is never needed or used.
  assert.throws(() => issueExactProductionIdentity(configWith()), {message: 'PRODUCTION_IDENTITY_WRONG_HOST'});
});
test('issueExactProductionIdentity: an entirely synthetic (wrong) project + host is rejected as WRONG_VERCEL_PROJECT first', () => {
  assert.throws(() => issueExactProductionIdentity(configWith({deployment: {projectId: 'a-completely-different-project-id'}})), {message: 'PRODUCTION_IDENTITY_WRONG_VERCEL_PROJECT'});
});
// issueExactProductionIdentity's own deployment.environment==='production' check (defense in
// depth on top of productionConfiguration()'s own validation) has no independent test: a
// productionConfiguration()-validated object is frozen, and isValidatedProductionConfiguration is
// a WeakSet identity check, so there is no legitimate way to construct an object that is both
// validated (same reference, in the WeakSet) and has a forged deployment.environment — the two
// properties are structurally exclusive here, which is the defense working as intended, not a gap.
test('issueExactProductionIdentity: releaseId is deliberately never checked — Layer B does not even accept it as an input, so it structurally cannot gate on it', () => {
  const a = configWith({deployment: {releaseId: 'release-a'}});
  const b = configWith({deployment: {releaseId: 'release-b'}});
  // Both fail identically (WRONG_HOST, the real reject boundary this repo can prove without the
  // real hostname) — proving releaseId plays no part in which field is reported wrong.
  assert.throws(() => issueExactProductionIdentity(a), {message: 'PRODUCTION_IDENTITY_WRONG_HOST'});
  assert.throws(() => issueExactProductionIdentity(b), {message: 'PRODUCTION_IDENTITY_WRONG_HOST'});
});
test('issueExactProductionIdentity: a hand-built lookalike (not productionConfiguration()-validated) is rejected before any identity comparison', () => {
  // isValidatedProductionConfiguration is a WeakSet object-identity check, not a shape check — a
  // byte-identical spread of an already-validated config is a *different* object and fails it.
  const lookalike = {...configWith()};
  assert.throws(() => issueExactProductionIdentity(lookalike), {message: 'PRODUCTION_IDENTITY_REQUIRES_VALIDATED_CONFIGURATION'});
});
test('the exact-identity capability is itself WeakMap-backed — a hand-built object shaped like one resolves to null, never a real configuration', () => {
  assert.equal(exactProductionIdentityConfiguration(undefined), null);
  assert.equal(exactProductionIdentityConfiguration({kind: 'EXACT_PRODUCTION_IDENTITY'} as never), null);
});

// V5: public readiness authority and pure target derivation are separate APIs.
test('readiness exposes only the exact-identity I/O entrypoint and pure derivation', () => {
  assert.deepEqual(Object.keys(readiness).sort(), ['deriveProductionDbReadinessTarget', 'probeProductionDatabaseReadiness']);
});
test('readiness target derivation is offline, immutable and conveys no identity authority', () => {
  const c = configWith();
  const target = readiness.deriveProductionDbReadinessTarget(c);
  assert.deepEqual(target, {service: 'content_read', host: c.database.host, database: c.database.name, role: c.database.roles.content_read, migrationsExpected: migrationPlan.length});
  assert.ok(Object.isFrozen(target));
  assert.equal(exactProductionIdentityConfiguration(target as never), null);
  assert.equal(readiness.deriveProductionDbReadinessTarget({...c, database: {...c.database, host: '  EP-SYNTHETIC.NEON.TECH  '}}).host, 'ep-synthetic.neon.tech');
});
test('readiness rejects raw configuration, fabricated identity and derived facts before invoking any connector', async () => {
  let calls = 0;
  const connect = async () => { calls++; throw new Error('CONNECTOR_MUST_NOT_BE_CALLED'); };
  const c = configWith();
  for (const forged of [{kind: 'EXACT_PRODUCTION_IDENTITY'}, Object.freeze({kind: 'EXACT_PRODUCTION_IDENTITY'}), c, readiness.deriveProductionDbReadinessTarget(c), undefined]) {
    assert.deepEqual(await readiness.probeProductionDatabaseReadiness(forged as never, {} as never, connect), {status: 'FAILED', reason: 'PRODUCTION_IDENTITY_REQUIRED'});
  }
  assert.equal(calls, 0);
});
