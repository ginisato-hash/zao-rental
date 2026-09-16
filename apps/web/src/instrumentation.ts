export async function register(){if(process.env.NEXT_RUNTIME==='nodejs'){const {bootstrapProductionRuntime}=await import('./lib/production-runtime');await bootstrapProductionRuntime();}}
