export async function register(){if(process.env.NEXT_RUNTIME==='nodejs'){
 const {installProductionHostingComposition}=await import('../../../packages/core/src/guest/production-hosting-composition');
 installProductionHostingComposition();
 const {bootstrapProductionRuntime}=await import('./lib/production-runtime');await bootstrapProductionRuntime();
}}
