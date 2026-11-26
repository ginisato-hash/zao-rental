/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose, see header */
const {createHash}=require('node:crypto');
const {existsSync,readdirSync,readFileSync,statSync}=require('node:fs');
const {join}=require('node:path');
/** Source-manifest digest of exactly the files the application is built from. It is computed INSIDE the build (next.config.ts, from the files
 *  that were uploaded and compiled) and recomputed by the operator from the clean main checkout; a deployment built from other sources cannot report
 *  the operator's digest, whatever environment value was given at deploy time. CommonJS and dependency-free on purpose: next.config.ts is compiled to CJS and requires it. */
const MANIFEST_ROOTS=['apps/web/src','apps/web/public','apps/web/next.config.ts','apps/web/tsconfig.json','packages','config','package.json','package-lock.json','vercel.json','tsconfig.json'];
const SKIP=new Set(['node_modules','.next','.git','.vercel','.local','.DS_Store']);
function walkManifestFiles(root){
 const out=[];
 const visit=(rel)=>{const abs=join(root,rel);if(!existsSync(abs))return;const s=statSync(abs);
  if(s.isDirectory()){for(const n of readdirSync(abs).sort())if(!SKIP.has(n))visit(rel+'/'+n);}else if(s.isFile())out.push(rel);};
 for(const r of MANIFEST_ROOTS)visit(r);
 return out.sort();
}
function manifestDigest(root,files){
 const h=createHash('sha256');
 for(const f of [...files].sort())h.update(f).update('\0').update(createHash('sha256').update(readFileSync(join(root,f))).digest('hex')).update('\n');
 return h.digest('hex');
}
function buildDigestFromTree(root){return manifestDigest(root,walkManifestFiles(root));}
module.exports={MANIFEST_ROOTS,walkManifestFiles,manifestDigest,buildDigestFromTree};
