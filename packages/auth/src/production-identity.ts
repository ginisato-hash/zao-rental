// F2 (TD correction): productionConfiguration() proves a syntactically-valid Production-shaped
// object; it does not prove it is *the* real Production target. A misconfigured-but-valid Neon
// branch, a different Vercel project, or a right-shaped-but-wrong database name would all pass
// productionConfiguration()'s parsing today. This module is the exact-identity gate on top of it.
//
// V4 (TD correction): the real Production Neon hostname is never committed to this (public)
// repository, not even in test fixtures — only its SHA-256 fingerprint is, below. The identity
// check is split into two pure layers precisely so both remain fully testable without it: Layer A
// (productionHostFingerprint/productionVercelProjectFingerprint — pure hashing, safe with any
// synthetic input) and Layer B (assertProductionIdentityFacts — pure, operates only on
// already-computed SHA-256 digests, never a raw hostname) can each be tested directly, including
// the accept path (using the pinned, already-public fingerprint constants below as input facts),
// without ever needing the real hostname string. issueExactProductionIdentity itself takes no
// override parameter at all, in product code or in any test — its own accept path is provable
// only in the real Production environment, the same disclosed trade-off as every pinned constant
// in this file.
import {createHash} from 'node:crypto';
import {isValidatedProductionConfiguration, type ProductionConfiguration} from './production-config';

/** Reused from PROD-R2B's own pinned Production backup host fingerprint
 * (scripts/production-backup.ts's EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256) — the same real
 * Neon endpoint this integration's database identity must bind to. The real hostname itself is
 * never committed; only this fingerprint. */
export const EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256 = '7ad9939654fde65fa8bf8c4c043e33ca9053036d2137cf7616d365a11876c3fc';
/** The live Neon readback the TD confirmed for this database. */
export const EXPECTED_PRODUCTION_DATABASE_NAME = 'neondb';
/** SHA-256 of the real Vercel project ID — committed as a fingerprint, not the raw ID. */
export const EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256 = 'da60fdc7da2f3acf7aab3dc1ff287912b439e84fe2ed20782838985be03f8101';

/** Layer A — pure fingerprint computation. Safe to test with any synthetic hostname/project id;
 * never touches or needs the real Production values to prove this logic is correct
 * (normalization, hashing) works. */
export function productionHostFingerprint(host: string): string {
  return createHash('sha256').update(host.trim().toLowerCase()).digest('hex');
}
export function productionVercelProjectFingerprint(projectId: string): string {
  return createHash('sha256').update(projectId).digest('hex');
}

export type ProductionIdentityFacts = Readonly<{
  hostFingerprintSha256: string;
  databaseName: string;
  vercelProjectFingerprintSha256: string;
}>;
const REAL_EXPECTED: ProductionIdentityFacts = {
  hostFingerprintSha256: EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,
  databaseName: EXPECTED_PRODUCTION_DATABASE_NAME,
  vercelProjectFingerprintSha256: EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256,
};

/** Layer B — pure fingerprint comparison, always against the real pinned identity (no `expected`
 * parameter: there is nothing here for a caller to override). Operates only on already-computed
 * SHA-256 digests, so its accept path is directly, fully testable by passing the pinned (public,
 * already-committed) fingerprint constants above as `facts` — no real hostname plaintext ever
 * needed for that proof. Throws the specific mismatched field so callers/tests can distinguish
 * host vs database vs Vercel project. */
export function assertProductionIdentityFacts(facts: ProductionIdentityFacts): void {
  if (facts.vercelProjectFingerprintSha256 !== REAL_EXPECTED.vercelProjectFingerprintSha256) throw new Error('PRODUCTION_IDENTITY_WRONG_VERCEL_PROJECT');
  if (facts.hostFingerprintSha256 !== REAL_EXPECTED.hostFingerprintSha256) throw new Error('PRODUCTION_IDENTITY_WRONG_HOST');
  if (facts.databaseName !== REAL_EXPECTED.databaseName) throw new Error('PRODUCTION_IDENTITY_WRONG_DATABASE_NAME');
}

export type ExactProductionIdentity = Readonly<{ kind: 'EXACT_PRODUCTION_IDENTITY' }>;
const issued = new WeakMap<ExactProductionIdentity, Readonly<ProductionConfiguration>>();

/** V4 (TD correction): no `expected`/override parameter of any kind, anywhere — this always
 * enforces the real pinned Production identity via the pure Layer A/B functions above, and there
 * is no test-only variant of this function in this module or anywhere else in the repository. A
 * caller-supplied identity bundle can never reach this comparison, in product code or in a test.
 * `deployment.releaseId` is deliberately never checked here — it changes on every deploy by
 * design and is validated only for shape by `productionConfiguration()` itself, as
 * current-runtime provenance, separate from this fixed project/database identity.
 *
 * The only way to obtain this capability is a genuinely `productionConfiguration()`-validated
 * object (checked via the same WeakSet-backed `isValidatedProductionConfiguration` capability
 * production-projection-authority.ts already relies on — a hand-built lookalike object is
 * rejected here too, not just shape-checked again) that additionally matches every real identity
 * fingerprint. The accept path (a config whose real host/project genuinely match) is provable
 * only in the real Production environment; reject paths (wrong host/db/project, still
 * synthetic/valid-shaped otherwise) are fully covered with synthetic fixtures — see
 * tests/unit/production-identity.test.ts. */
export function issueExactProductionIdentity(c: Readonly<ProductionConfiguration>): ExactProductionIdentity {
  if (!isValidatedProductionConfiguration(c)) throw new Error('PRODUCTION_IDENTITY_REQUIRES_VALIDATED_CONFIGURATION');
  if (c.deployment.provider !== 'VERCEL' || c.deployment.environment !== 'production') throw new Error('PRODUCTION_IDENTITY_WRONG_ENVIRONMENT');
  assertProductionIdentityFacts({
    hostFingerprintSha256: productionHostFingerprint(c.database.host),
    databaseName: c.database.name,
    vercelProjectFingerprintSha256: productionVercelProjectFingerprint(c.deployment.projectId),
  });
  const capability: ExactProductionIdentity = Object.freeze({ kind: 'EXACT_PRODUCTION_IDENTITY' });
  issued.set(capability, c);
  return capability;
}
export function exactProductionIdentityConfiguration(capability?: ExactProductionIdentity): Readonly<ProductionConfiguration> | null {
  return capability ? issued.get(capability) ?? null : null;
}
