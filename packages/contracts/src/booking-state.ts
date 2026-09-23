/** Mode and state are one invariant; a commercial state never authorizes a sandbox row. */
export function bookingConfirmed(mode:string,state:string):boolean{
 return mode==='SQUARE_PRODUCTION'?state==='CONFIRMED':['SIMULATED_DEV','SQUARE_SANDBOX'].includes(mode)&&state==='CONFIRMED_DEV';
}
export function bookingCompleted(mode:string,state:string):boolean{
 return mode==='SQUARE_PRODUCTION'?state==='COMPLETED':['SIMULATED_DEV','SQUARE_SANDBOX'].includes(mode)&&state==='COMPLETED_DEV';
}
export function bookingStateValid(mode:string,state:string):boolean{
 return ['SIMULATED_DEV','SQUARE_SANDBOX','SQUARE_PRODUCTION'].includes(mode)&&(['DRAFT','PAYMENT_PENDING','PAYMENT_REVIEW','CANCELLED'].includes(state)||bookingConfirmed(mode,state)||bookingCompleted(mode,state));
}
