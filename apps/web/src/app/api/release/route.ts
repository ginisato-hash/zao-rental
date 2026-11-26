export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'};
/** Release attestation probe: returns only the build commit id that the operator bound to THIS deployment at deploy time
 *  (vercel deploy -e RELEASE_BUILD_SHA=<sha>, immutable per deployment). The repository is public, so a commit id is not a secret.
 *  buildDigest is the sha256 manifest of the sources compiled by THIS build (computed in next.config.ts, not supplied by the operator); the operator recomputes it from the clean checkout.
 *  Anything that is not exactly 40 lowercase hex is reported as UNBOUND; no other environment value or detail is ever returned. */
export function GET(){const v=process.env.RELEASE_BUILD_SHA,d=process.env.RELEASE_BUILD_DIGEST;return Response.json({releaseSha:typeof v==='string'&&/^[a-f0-9]{40}$/.test(v)?v:'UNBOUND',buildDigest:typeof d==='string'&&/^[a-f0-9]{64}$/.test(d)?d:'UNBUILT'},{headers});}
