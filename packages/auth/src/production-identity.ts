// F2 (TD correction): productionConfiguration() proves a syntactically-valid Production-shaped
// object; it does not prove it is *the* real Production target. A misconfigured-but-valid Neon
// branch, a different Vercel project, or a right-shaped-but-wrong database name would all pass
// productionConfiguration()'s parsing today. This module is the exact-identity gate on top of it.
import {createHash} from 'node:crypto';
import {isValidatedProductionConfiguration, type ProductionConfiguration} from './production-config';

/** Reused from PROD-R2B's own pinned Production backup host fingerprint
 * (scripts/production-backup.ts's EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256) — the same real
 * Neon endpoint this integration's database identity must bind to. */
export const EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256 = '7ad9939654fde65fa8bf8c4c043e33ca9053036d2137cf7616d365a11876c3fc';
/** The live Neon readback the TD confirmed for this database. */
export const EXPECTED_PRODUCTION_DATABASE_NAME = 'neondb';
/** SHA-256 of the real Vercel project ID (`prj_ehUMOzM77em9DVnHJBJffncD5hg7`, `zao-rental`,
 * team `team_PVka5z4T6OMKBmUcqrK09yJz`) — committed as a fingerprint, not the raw ID, per the
 * directive's own preference.
 *
 * V3-D (TD correction): this worktree has no `.vercel/project.json` (there is no linked project
 * here), so the raw ID above was NOT read from that file on this Mac — the earlier comment
 * claiming so was inaccurate. The actual provenance is the TD-confirmed real Vercel project
 * identity carried forward from this integration's own prior commits; this correction only fixes
 * the false claim, it does not change the pinned value itself. */
export const EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256 = 'da60fdc7da2f3acf7aab3dc1ff287912b439e84fe2ed20782838985be03f8101';

const hostFingerprint = (host: string) => createHash('sha256').update(host.trim().toLowerCase()).digest('hex');
const projectFingerprint = (projectId: string) => createHash('sha256').update(projectId).digest('hex');

export type ExpectedProductionIdentity = {
  hostFingerprintSha256: string;
  databaseName: string;
  vercelProjectFingerprintSha256: string;
};
const REAL_EXPECTED: ExpectedProductionIdentity = {
  hostFingerprintSha256: EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,
  databaseName: EXPECTED_PRODUCTION_DATABASE_NAME,
  vercelProjectFingerprintSha256: EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256,
};

/** Not exported: `expected` is only ever REAL_EXPECTED from the product path
 * (`issueExactProductionIdentity` below). The test-only override lives in
 * `issueExactProductionIdentityForTesting`, which calls this same check — so there is exactly one
 * place, not two, where a caller-supplied `expected` can reach this comparison, and it is not part
 * of the product's exported surface.
 *
 * Deliberately does NOT pin `deployment.releaseId` — that changes on every deploy by design and
 * is validated only for shape by `productionConfiguration()` itself, as current-runtime
 * provenance, separate from this fixed project/database identity. */
function assertIdentity(c: Readonly<ProductionConfiguration>, expected: ExpectedProductionIdentity): void {
  if (c.deployment.provider !== 'VERCEL' || c.deployment.environment !== 'production') throw new Error('PRODUCTION_IDENTITY_WRONG_ENVIRONMENT');
  if (projectFingerprint(c.deployment.projectId) !== expected.vercelProjectFingerprintSha256) throw new Error('PRODUCTION_IDENTITY_WRONG_VERCEL_PROJECT');
  if (hostFingerprint(c.database.host) !== expected.hostFingerprintSha256) throw new Error('PRODUCTION_IDENTITY_WRONG_HOST');
  if (c.database.name !== expected.databaseName) throw new Error('PRODUCTION_IDENTITY_WRONG_DATABASE_NAME');
}

export type ExactProductionIdentity = Readonly<{ kind: 'EXACT_PRODUCTION_IDENTITY' }>;
const issued = new WeakMap<ExactProductionIdentity, Readonly<ProductionConfiguration>>();

function issue(c: Readonly<ProductionConfiguration>, expected: ExpectedProductionIdentity): ExactProductionIdentity {
  if (!isValidatedProductionConfiguration(c)) throw new Error('PRODUCTION_IDENTITY_REQUIRES_VALIDATED_CONFIGURATION');
  assertIdentity(c, expected);
  const capability: ExactProductionIdentity = Object.freeze({ kind: 'EXACT_PRODUCTION_IDENTITY' });
  issued.set(capability, c);
  return capability;
}

/** V3-A (TD correction): this always enforces the real pinned Production identity — there is no
 * `expected` parameter to override it, so no caller (production or otherwise) can pass a wrong
 * target through the product path. The only way to obtain this capability is a genuinely
 * `productionConfiguration()`-validated object (checked via the same WeakSet-backed
 * `isValidatedProductionConfiguration` capability production-projection-authority.ts already
 * relies on — a hand-built lookalike object is rejected here too, not just shape-checked again)
 * that additionally matches every real identity fingerprint. */
export function issueExactProductionIdentity(c: Readonly<ProductionConfiguration>): ExactProductionIdentity {
  return issue(c, REAL_EXPECTED);
}

/** Test-only: the sole place a caller may supply its own `expected` bundle (computed from its own
 * synthetic host/project id, matching this project's established R2B-F4 pattern for
 * `assertProductionHostFingerprint`), so both the accept and reject paths can be exercised without
 * ever needing the real secrets. Not imported by any product-runtime code path — grep this
 * repository for its name before adding a new caller outside `tests/`. */
export function issueExactProductionIdentityForTesting(c: Readonly<ProductionConfiguration>, expected: ExpectedProductionIdentity): ExactProductionIdentity {
  return issue(c, expected);
}
export function exactProductionIdentityConfiguration(capability?: ExactProductionIdentity): Readonly<ProductionConfiguration> | null {
  return capability ? issued.get(capability) ?? null : null;
}
