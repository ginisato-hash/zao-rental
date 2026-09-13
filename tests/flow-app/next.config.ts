import type {NextConfig} from 'next';
const config:NextConfig={poweredByHeader:false,devIndicators:false,async headers(){return [{source:'/api/:path*',headers:[{key:'X-Robots-Tag',value:'noindex, nofollow'},{key:'Cache-Control',value:'private, no-store'}]}];}};export default config;
