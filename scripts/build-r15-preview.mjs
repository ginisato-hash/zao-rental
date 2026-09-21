import {build} from 'esbuild';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
export async function buildR15Preview(out){
 const root=resolve(out),func=join(root,'.vercel/output/functions/operator.func');await mkdir(func,{recursive:true});
 const result=await build({entryPoints:['tools/acceptance/r15-preview-entry.ts'],outfile:join(func,'entry.cjs'),bundle:true,platform:'node',target:'node24',format:'cjs',packages:'bundle',external:['pg-native'],metafile:true,logLevel:'silent',sourcemap:false});
 await writeFile(join(func,'index.cjs'),"module.exports = require('./entry.cjs').default;\n");
 await writeFile(join(func,'.vc-config.json'),JSON.stringify({runtime:'nodejs24.x',handler:'index.cjs',launcherType:'Nodejs',shouldAddHelpers:false,shouldAddSourcemapSupport:false,maxDuration:60}));
 await writeFile(join(root,'.vercel/output/config.json'),JSON.stringify({version:3,routes:[{src:'/',dest:'/operator'},{src:'/api/r15/(preflight|subscription|test|payment|reconcile|delete-subscription)',dest:'/operator'},{src:'/(.*)',status:404}]}));
 await writeFile(join(root,'.vercel/project.json'),JSON.stringify({projectId:'prj_ehUMOzM77em9DVnHJBJffncD5hg7',orgId:'team_PVka5z4T6OMKBmUcqrK09yJz',projectName:'zao-rental'}));
 const bytes=await readFile(join(func,'entry.cjs'));
 return {bundleSha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,inputs:Object.keys(result.metafile.inputs).sort(),target:'preview',customerRoutes:0,secretsIncluded:false};
}
if(process.argv[2])console.log(JSON.stringify(await buildR15Preview(process.argv[2])));
