import type { NextConfig } from 'next';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

// Digest of the sources this build compiles (see scripts/lib/build-manifest.cjs); inlined so /api/release can report it. Not an operator-supplied value.
const buildRoot=existsSync(join(process.cwd(),'apps/web/next.config.ts'))?process.cwd():join(process.cwd(),'..','..');
// Resolved from the build root at run time (not a static relative import: Next compiles this file to a temporary module).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {buildDigestFromTree}=require(join(buildRoot,'scripts/lib/build-manifest.cjs')) as {buildDigestFromTree:(root:string)=>string};
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages:['@node-rs/argon2'],
  logging: false,
  env:{RELEASE_BUILD_DIGEST:buildDigestFromTree(buildRoot)},
  async headers() {
    // Page indexing is decided per request by proxy.ts from PublicationAuthority (noindex unless
    // installed, exact origin and allowlisted path). A static page-wide X-Robots-Tag here would
    // make that authority unreachable; APIs stay statically noindex below.
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }, {source:'/api/:path*',headers:[{key:'X-Robots-Tag',value:'noindex, nofollow'},{key:'Cache-Control',value:'private, no-store'}]}];
  },
};
export default config;
