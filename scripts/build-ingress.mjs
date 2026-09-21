import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
/** Build-time only: preserve ordinary app TS imports; ship one explicit CJS ingress module. */
export async function buildIngress(outfile=path.join(root,'apps/webhook-ingress/runtime.cjs')){
 const result=await build({absWorkingDir:root,entryPoints:['apps/webhook-ingress/src/handler.ts'],
  outfile,bundle:true,platform:'node',target:'node24',format:'cjs',packages:'bundle',
  external:['pg-native'],metafile:true,logLevel:'silent',sourcemap:false});
 const bytes=await readFile(outfile);
 return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
  inputs:Object.keys(result.metafile.inputs).sort(),externalOptional:['pg-native']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await buildIngress();console.log(JSON.stringify(result));
}
