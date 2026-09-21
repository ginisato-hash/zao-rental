import {composeProductionRuntime,type ProductionRuntime,type ProductionRuntimeInput} from './production-runtime';
import {ProductionStartupError,type StartupStage} from '../../../auth/src/production-config';
type State={input:ProductionRuntimeInput|null;pending:Promise<ProductionRuntime>|null;runtime:ProductionRuntime|null;failure:StartupStage|null};
const key=Symbol.for('zao.production.runtime.v1');
const container=globalThis as typeof globalThis&{[key]?:State};
const state=()=>container[key]??=( {input:null,pending:null,runtime:null,failure:null} );
/** Called once by a trusted server bootstrap/hosting integration, never a route.
 * Credentials and verified dispatcher metadata are passed directly in memory. */
export function installProductionBootstrap(input:ProductionRuntimeInput){const s=state();if(s.input||s.pending||s.runtime||s.failure)throw new ProductionStartupError('FEATURE_FLAGS');s.input=input;}
export function productionRequested(){const s=state();return s.input!==null||s.pending!==null||s.runtime!==null||s.failure!==null||process.env.ZAO_PRODUCTION_RUNTIME!==undefined;}
/** Startup is latched, including failure. No retries or fallback to Preview/dev. */
export async function bootstrapProductionRuntime(){const s=state();if(!productionRequested())return null;if(s.pending)return s.pending;if(!s.input){s.failure='FEATURE_FLAGS';throw new ProductionStartupError(s.failure);}return s.pending??=(async()=>{
 try{const r=await composeProductionRuntime(s.input!);s.runtime=r;return r;}catch(e){s.failure=e instanceof ProductionStartupError?e.stage:'FEATURE_FLAGS';throw new ProductionStartupError(s.failure);}finally{s.input=null;}
})();}
export function getProductionRuntime(){const s=state();return s.failure||s.runtime?.safeStatus().APP!=='READY'?null:s.runtime;}
export function productionStartupState(){const s=state();return {ready:s.runtime?.safeStatus().APP==='READY'&&!s.failure,stage:s.failure??(s.runtime?'READY':'FEATURE_FLAGS')};}
