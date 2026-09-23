export async function register(){if(process.env.NEXT_RUNTIME==='nodejs'){
 // Each profile installs only when ZAO_PRODUCTION_HOSTING_ACTIVATION equals its own token, so at
 // most one ever calls installProductionBootstrap (a second install would itself throw).
 const {installProductionHostingComposition}=await import('../../../packages/core/src/guest/production-hosting-composition');
 const {installProductionCommercialComposition}=await import('../../../packages/core/src/guest/production-commercial-composition');
 installProductionHostingComposition();
 installProductionCommercialComposition();
 const {bootstrapProductionRuntime}=await import('./lib/production-runtime');await bootstrapProductionRuntime();
}}
