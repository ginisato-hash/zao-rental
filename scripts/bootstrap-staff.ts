import type {Pool} from 'pg';
import {insertAccount} from '../packages/auth/src/accounts';
// Explicit operator-only procedure, not imported by routes. No first-login rule or guessed identity.
export async function bootstrapDevelopmentAdmin(pool:Pool,input:{email:string;password:string;displayName:string}){
 const db=(await pool.query('SELECT current_database() AS name')).rows[0];if(!/^zr_[a-f0-9]{12}$/.test(db.name))throw new Error('NOT_OWNED_DEVELOPMENT_DATABASE');
 const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(7080501)');if((await client.query('SELECT 1 FROM staff_members LIMIT 1')).rowCount)throw new Error('BOOTSTRAP_ALREADY_COMPLETED');
 const id=await insertAccount(client,{...input,active:true,role:'ADMIN',scope:'ALL',storeIds:[],permissions:{}},null);await client.query('COMMIT');return id;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
