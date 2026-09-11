import {hash,verify} from '@node-rs/argon2';
export const passwordPolicy={min:15,max:128} as const;
export function validPassword(value:unknown):value is string{return typeof value==='string'&&value.length>=passwordPolicy.min&&value.length<=passwordPolicy.max;}
export function hashStaffPassword(value:string){return hash(value,{algorithm:2,version:1,memoryCost:65536,timeCost:3,parallelism:1,outputLen:32});}
export async function verifyStaffPassword(input:{hash:string;password:string}){try{return await verify(input.hash,input.password);}catch{return false;}}
export function canonicalEmail(value:unknown):string {
 if(typeof value!=='string')throw new Error('INVALID_EMAIL');const email=value.trim().toLowerCase();
 if(email.length>254||! /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(email))throw new Error('INVALID_EMAIL');
 return email;
}
