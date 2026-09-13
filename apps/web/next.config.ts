import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages:['@node-rs/argon2'],
  logging: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      ...(process.env.NODE_ENV!=='production'&&process.env.ZAO_TEST_PUBLIC_INDEXING==='1'?[]:[{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]),
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }, {source:'/api/:path*',headers:[{key:'X-Robots-Tag',value:'noindex, nofollow'},{key:'Cache-Control',value:'private, no-store'}]}];
  },
};
export default config;
