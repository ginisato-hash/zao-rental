import {randomUUID} from 'node:crypto';
export type StaffOperationPhase='AUTHENTICATION'|'LIST'|'INPUT'|'WRITE';
const allowedSqlStates=new Set(['23505','23503','23514','40001','40P01','53300','57014','08003','08006','57P01']);
/** Deliberately no message, stack, SQL, request fields or identity. No nested causes/getters. */
export function staffOperationDiagnostic(error:unknown,phase:StaffOperationPhase){
 let category='OTHER';
 try{const descriptor=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'code'):undefined;const code=descriptor?.value;if(typeof code==='string'&&allowedSqlStates.has(code))category=code;}catch{/* hostile object/proxy remains OTHER */}
 return {code:'STAFF_OPERATION_DIAGNOSTIC',correlationId:randomUUID(),phase,category};
}
