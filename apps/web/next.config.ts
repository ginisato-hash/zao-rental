import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages:['@node-rs/argon2'],
  logging: false,
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
