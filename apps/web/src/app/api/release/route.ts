export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'};
/** Release attestation probe: returns only the build commit id that the operator bound to THIS deployment at deploy time
 *  (vercel deploy -e RELEASE_BUILD_SHA=<sha>, immutable per deployment). The repository is public, so a commit id is not a secret.
 *  Anything that is not exactly 40 lowercase hex is reported as UNBOUND; no other environment value or detail is ever returned. */
export function GET(){const v=process.env.RELEASE_BUILD_SHA;return Response.json({releaseSha:typeof v==='string'&&/^[a-f0-9]{40}$/.test(v)?v:'UNBOUND'},{headers});}
