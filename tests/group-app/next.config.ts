import type {NextConfig} from 'next';
// Test-only dev server (next dev). By default an entry idle for 60 s is disposed and recompiled on its next visit; the
// webpack dev reloader may then broadcast RELOAD_PAGE ("_document has changed"), and every open page runs
// location.reload(). A page that is navigating at that moment (e.g. guest logout -> /ja) is reloaded instead (CI
// #44701174510: GET /ja aborted, GET /ja/book reloaded). Keep compiled entries for the whole test run.
const config:NextConfig={poweredByHeader:false,devIndicators:false,onDemandEntries:{maxInactiveAge:6*60*60*1000,pagesBufferLength:500},async headers(){return [{source:'/api/:path*',headers:[{key:'X-Robots-Tag',value:'noindex, nofollow'},{key:'Cache-Control',value:'private, no-store'}]}];}};export default config;
